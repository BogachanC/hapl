// Hapl Search Index sync — Stage 1 of Meilisearch POC.
//
// Builds Meili documents from content_titles + content_title_aliases +
// content_availability (TR + available) and pushes them in batches.
//
// Auth: admin JWT OR x-hapl-sync-token header matching HAPL_SYNC_TOKEN secret.
// State: single-row per index_name in `search_index_state`.
//
// Actions:
//   - setup_index        : create + apply settings (idempotent)
//   - full_sync_start    : reset offset, count totals, do first batch
//   - full_sync_continue : continue from current_offset
//   - sync_batch         : alias for full_sync_continue (legacy callers)
//   - status             : return current state row
//
// Stage 1 explicitly does NOT touch search-content. MEILI_ENABLED flag has
// no effect on sync — sync always runs when called; the flag only gates
// reads in Stage 2.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  ensureIndexSettings,
  getMeiliConfig,
  isMeiliConfigured,
  mapContentTitleToMeiliDocument,
  searchMeili,
  upsertDocuments,
  type MeiliDoc,
} from "../_shared/meili.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-hapl-sync-token, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DEFAULT_BATCH_SIZE = 200;
const MAX_BATCH_SIZE = 500;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ─── auth ────────────────────────────────────────────────────────────────
async function authorize(req: Request, sb: any): Promise<{ ok: boolean; reason?: string }> {
  // 1) Header-based sync token (server-to-server)
  const tokenHeader = req.headers.get("x-hapl-sync-token");
  if (tokenHeader) {
    const expected = Deno.env.get("HAPL_SYNC_TOKEN");
    if (expected && tokenHeader === expected) return { ok: true };
    return { ok: false, reason: "invalid sync token" };
  }
  // 2) Admin JWT
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return { ok: false, reason: "missing auth" };
  const { data: userRes, error } = await sb.auth.getUser(jwt);
  if (error || !userRes?.user) return { ok: false, reason: "invalid jwt" };
  const { data: roleRow } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", userRes.user.id)
    .eq("role", "admin")
    .maybeSingle();
  if (!roleRow) return { ok: false, reason: "not admin" };
  return { ok: true };
}

// ─── state helpers ───────────────────────────────────────────────────────
async function loadState(sb: any, indexName: string) {
  const { data } = await sb
    .from("search_index_state")
    .select("*")
    .eq("index_name", indexName)
    .maybeSingle();
  return data;
}

async function upsertState(sb: any, indexName: string, patch: Record<string, unknown>) {
  const existing = await loadState(sb, indexName);
  if (!existing) {
    const { data } = await sb
      .from("search_index_state")
      .insert({ index_name: indexName, ...patch })
      .select("*")
      .single();
    return data;
  }
  const { data } = await sb
    .from("search_index_state")
    .update(patch)
    .eq("id", existing.id)
    .select("*")
    .single();
  return data;
}

// ─── total title counter ────────────────────────────────────────────────
// Counts titles that have at least one TR available row AND a poster.
// Mirrors the WHERE clause used by collectBatch().
async function countEligibleTitles(sb: any): Promise<number> {
  // Count via two-step: get title_ids with TR availability, then intersect with poster.
  // We can't easily JOIN through the REST client, so approximate with a server-side
  // function-less count: fetch unique title_ids with availability, then count titles with poster.
  // For Stage 1 this only runs once per full_sync_start so the cost is acceptable.
  const { data: availRows } = await sb
    .from("content_availability")
    .select("title_id")
    .eq("region", "TR")
    .eq("status", "available")
    .limit(50000);
  const ids = Array.from(new Set((availRows || []).map((r: any) => r.title_id)));
  if (ids.length === 0) return 0;
  // chunk to avoid URL length issues
  const CHUNK = 500;
  let total = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const { count } = await sb
      .from("content_titles")
      .select("id", { count: "exact", head: true })
      .in("id", slice)
      .not("poster_path", "is", null);
    total += count || 0;
  }
  return total;
}

// ─── batch builder ──────────────────────────────────────────────────────
async function collectBatch(
  sb: any,
  offset: number,
  limit: number,
): Promise<{ docs: MeiliDoc[]; titleCount: number; hasMore: boolean }> {
  // 1) Title slice — ordered for stable pagination.
  const { data: titles, error: titleErr } = await sb
    .from("content_titles")
    .select(
      "id, tmdb_id, tmdb_type, title, original_title, normalized_title, release_year, poster_path, backdrop_path, genres, content_kind, metadata, updated_at",
    )
    .not("poster_path", "is", null)
    .order("id", { ascending: true })
    .range(offset, offset + limit - 1);
  if (titleErr) throw new Error(`titles fetch failed: ${titleErr.message}`);
  const titleRows = titles || [];
  if (titleRows.length === 0) return { docs: [], titleCount: 0, hasMore: false };

  const titleUuids: string[] = titleRows.map((t: any) => t.id);

  // 2) Availability (TR, available) for these titles.
  const { data: availRows } = await sb
    .from("content_availability")
    .select("title_id, provider_id, status, source, confidence")
    .in("title_id", titleUuids)
    .eq("region", "TR")
    .eq("status", "available");

  // Drop titles without TR availability.
  const availByTitle = new Map<string, any[]>();
  for (const a of availRows || []) {
    const arr = availByTitle.get(a.title_id) || [];
    arr.push(a);
    availByTitle.set(a.title_id, arr);
  }

  const providerIds = Array.from(
    new Set((availRows || []).map((a: any) => a.provider_id)),
  );
  const providerById = new Map<string, any>();
  if (providerIds.length > 0) {
    const { data: provs } = await sb
      .from("streaming_providers")
      .select("id, slug, display_name")
      .in("id", providerIds);
    for (const p of provs || []) providerById.set(p.id, p);
  }

  // 3) Aliases.
  const tmdbKeys = titleRows.map((t: any) => ({ id: t.tmdb_id, type: t.tmdb_type }));
  const movieIds = tmdbKeys.filter((k) => k.type === "movie").map((k) => k.id);
  const tvIds = tmdbKeys.filter((k) => k.type === "tv").map((k) => k.id);
  const aliasTasks: Promise<any>[] = [];
  if (movieIds.length > 0) {
    aliasTasks.push(
      sb.from("content_title_aliases")
        .select("tmdb_id, tmdb_type, alias")
        .eq("tmdb_type", "movie")
        .in("tmdb_id", movieIds),
    );
  }
  if (tvIds.length > 0) {
    aliasTasks.push(
      sb.from("content_title_aliases")
        .select("tmdb_id, tmdb_type, alias")
        .eq("tmdb_type", "tv")
        .in("tmdb_id", tvIds),
    );
  }
  const aliasRes = await Promise.all(aliasTasks);
  const aliasByKey = new Map<string, { alias: string }[]>();
  for (const r of aliasRes) {
    for (const row of r.data || []) {
      const key = `${row.tmdb_type}:${row.tmdb_id}`;
      const arr = aliasByKey.get(key) || [];
      arr.push({ alias: row.alias });
      aliasByKey.set(key, arr);
    }
  }

  // 4) Build documents — only for titles with at least one available provider.
  const docs: MeiliDoc[] = [];
  for (const t of titleRows) {
    const avails = availByTitle.get(t.id) || [];
    if (avails.length === 0) continue; // skip — not TR-available
    const aliases = aliasByKey.get(`${t.tmdb_type}:${t.tmdb_id}`) || [];
    docs.push(mapContentTitleToMeiliDocument(t, aliases, avails, providerById));
  }

  return { docs, titleCount: titleRows.length, hasMore: titleRows.length === limit };
}

// ─── handler ─────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const auth = await authorize(req, sb);
    if (!auth.ok) {
      return json({ ok: false, error: `unauthorized: ${auth.reason}` }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const action: string = String(body?.action || "status");
    const cfg = getMeiliConfig();
    const batchSize = Math.min(
      MAX_BATCH_SIZE,
      Math.max(50, Number(body?.batch_size) || DEFAULT_BATCH_SIZE),
    );

    // status is the only action that works without Meili being configured —
    // helps the admin panel show the "missing config" state cleanly.
    if (action === "status") {
      const state = await loadState(sb, cfg.indexName);
      return json({
        ok: true,
        meili_configured: isMeiliConfigured(cfg),
        meili_enabled: cfg.enabled,
        index_name: cfg.indexName,
        state: state ?? null,
      });
    }

    if (!isMeiliConfigured(cfg)) {
      return json({
        ok: false,
        error: "Meilisearch not configured (MEILI_HOST / MEILI_MASTER_KEY missing)",
      }, 400);
    }

    // Read-only: Meili index stats (document count etc.)
    if (action === "meili_stats") {
      const host = cfg.host;
      const res = await fetch(`${host}/indexes/${cfg.indexName}/stats`, {
        headers: { Authorization: `Bearer ${cfg.masterKey}` },
      });
      const data = await res.json().catch(() => ({}));
      return json({ ok: res.ok, status: res.status, stats: data });
    }

    // Read-only: golden query test against Meili
    if (action === "golden_test") {
      const queries: string[] = Array.isArray(body?.queries) && body.queries.length > 0
        ? body.queries.map((q: any) => String(q))
        : [
          "fast and furious", "hızlı ve öfkeli", "şrek", "shrek",
          "buz devri", "ice age", "money heist", "la casa de papel",
          "friends", "dark", "the office", "game of thrones",
          "behzat", "the wire", "mentalist", "harry potter",
          "lord of the rings", "yan yana", "yanyana",
        ];
      const results: any[] = [];
      for (const q of queries) {
        try {
          const r = await searchMeili({ q, limit: 3 }, cfg);
          results.push({
            q,
            total: r.estimatedTotalHits,
            top: r.hits.map((h) => ({
              id: h.id, title: h.title, year: h.year,
              providers: h.providers, type: h.type,
            })),
          });
        } catch (e: any) {
          results.push({ q, error: e?.message || String(e) });
        }
      }
      return json({ ok: true, results });
    }



    if (action === "setup_index") {
      const r = await ensureIndexSettings(cfg);
      const state = await upsertState(sb, cfg.indexName, {
        last_error: null,
        meta: { last_setup_at: new Date().toISOString() },
      });
      return json({ ok: true, setup: r, state });
    }

    if (action === "full_sync_start") {
      // Reset counters, count totals, then do the first batch.
      const total = await countEligibleTitles(sb);
      await upsertState(sb, cfg.indexName, {
        indexed_count: 0,
        failed_count: 0,
        current_offset: 0,
        total_titles: total,
        has_more: total > 0,
        last_error: null,
      });
      // fall through to do one batch
      body.action = "full_sync_continue";
    }

    if (action === "full_sync_continue" || action === "sync_batch" || body.action === "full_sync_continue") {
      const state = (await loadState(sb, cfg.indexName)) || {
        index_name: cfg.indexName,
        current_offset: 0,
        indexed_count: 0,
        failed_count: 0,
        total_titles: 0,
      };
      const offset: number = Number(state.current_offset) || 0;
      let batch;
      try {
        batch = await collectBatch(sb, offset, batchSize);
      } catch (e: any) {
        await upsertState(sb, cfg.indexName, { last_error: e?.message || String(e) });
        return json({ ok: false, error: e?.message || String(e) }, 500);
      }

      let pushed = 0;
      let failed = 0;
      if (batch.docs.length > 0) {
        try {
          const r = await upsertDocuments(batch.docs, cfg);
          pushed = r.count;
        } catch (e: any) {
          failed = batch.docs.length;
          await upsertState(sb, cfg.indexName, {
            last_error: `meili upsert failed: ${e?.message || String(e)}`,
            current_offset: offset + batch.titleCount, // still advance — avoid infinite stuck batch
            failed_count: (state.failed_count || 0) + failed,
            has_more: batch.hasMore,
          });
          return json({ ok: false, error: e?.message || String(e) }, 500);
        }
      }

      const nextOffset = offset + batch.titleCount;
      const newState = await upsertState(sb, cfg.indexName, {
        current_offset: nextOffset,
        indexed_count: (state.indexed_count || 0) + pushed,
        failed_count: (state.failed_count || 0) + failed,
        has_more: batch.hasMore,
        last_synced_at: new Date().toISOString(),
        last_error: null,
      });

      return json({
        ok: true,
        action: "full_sync_continue",
        batch_size: batchSize,
        titles_scanned: batch.titleCount,
        docs_pushed: pushed,
        docs_failed: failed,
        next_offset: nextOffset,
        has_more: batch.hasMore,
        state: newState,
      });
    }

    return json({ ok: false, error: `unknown action: ${action}` }, 400);
  } catch (e: any) {
    console.error("[hapl-sync-search-index] fatal:", e);
    return json({ ok: false, error: e?.message || String(e) }, 500);
  }
});
