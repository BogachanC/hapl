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
  deleteIndex,
  ensureIndexSettings,
  getMeiliConfig,
  isMeiliConfigured,
  mapContentTitleToMeiliDocument,
  searchMeili,
  upsertDocuments,
  waitForTask,
  type MeiliDoc,
} from "../_shared/meili.ts";
import {
  ELIGIBLE_AVAILABILITY_TYPES,
  ELIGIBLE_MIN_CONFIDENCE,
  applyEligibilityFilter,
  isEligibleAvail,
} from "../_shared/eligibility.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-hapl-sync-token, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Keep batches small — PostgREST `.in()` URL length silently caps results
// above ~150 UUIDs which makes whole batches return 0 docs without errors.
const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 200;


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

  // 2) Availability (TR, ELIGIBLE) for these titles. Uses the shared
  // eligibility filter so collectBatch agrees with sync_dirty_titles and the
  // DB fallback path: rent-only / buy-only / low-confidence titles do not
  // produce a Meili doc and therefore stay tombstoned (any pre-existing doc
  // is updated by sync_dirty_titles / backfill, never resurrected here).
  const availQuery = applyEligibilityFilter(
    sb.from("content_availability")
      .select("title_id, provider_id, status, source, confidence, availability_type"),
  ).in("title_id", titleUuids);
  const { data: availRows } = await availQuery;

  // Drop titles without eligible TR availability.
  const availByTitle = new Map<string, any[]>();
  for (const a of availRows || []) {
    if (!isEligibleAvail(a as any)) continue; // belt + suspenders
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
        .select("tmdb_id, tmdb_type, alias, source, language, country")
        .eq("tmdb_type", "movie")
        .in("tmdb_id", movieIds),
    );
  }
  if (tvIds.length > 0) {
    aliasTasks.push(
      sb.from("content_title_aliases")
        .select("tmdb_id, tmdb_type, alias, source, language, country")
        .eq("tmdb_type", "tv")
        .in("tmdb_id", tvIds),
    );
  }
  const aliasRes = await Promise.all(aliasTasks);
  const aliasByKey = new Map<string, { alias: string; source: string | null; language: string | null; country: string | null }[]>();
  for (const r of aliasRes) {
    for (const row of r.data || []) {
      const key = `${row.tmdb_type}:${row.tmdb_id}`;
      const arr = aliasByKey.get(key) || [];
      arr.push({ alias: row.alias, source: row.source ?? null, language: row.language ?? null, country: row.country ?? null });
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
      const [statsRes, indexesRes, tasksRes] = await Promise.all([
        fetch(`${host}/indexes/${cfg.indexName}/stats`, {
          headers: { Authorization: `Bearer ${cfg.masterKey}` },
        }),
        fetch(`${host}/indexes?limit=50`, {
          headers: { Authorization: `Bearer ${cfg.masterKey}` },
        }),
        fetch(`${host}/tasks?indexUids=${cfg.indexName}&limit=5`, {
          headers: { Authorization: `Bearer ${cfg.masterKey}` },
        }),
      ]);
      const stats = await statsRes.json().catch(() => ({}));
      const indexes = await indexesRes.json().catch(() => ({}));
      const tasks = await tasksRes.json().catch(() => ({}));
      return json({
        ok: statsRes.ok,
        host_suffix: host.slice(-40),
        index_name: cfg.indexName,
        stats,
        indexes,
        recent_tasks: tasks,
      });
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

    // Read-only: inspect full Meili docs for given queries (debug/report)
    if (action === "inspect_docs") {
      const queries: string[] = Array.isArray(body?.queries) ? body.queries.map((q: any) => String(q)) : [];
      const limit = Math.max(1, Math.min(5, Number(body?.limit) || 1));
      const out: any[] = [];
      for (const q of queries) {
        try {
          const r = await searchMeili({ q, limit }, cfg);
          out.push({
            q,
            total: r.estimatedTotalHits,
            hits: r.hits.map((h: any) => ({
              id: h.id,
              title: h.title,
              original_title: h.original_title,
              localized_title_tr: h.localized_title_tr,
              exact_aliases: h.exact_aliases,
              franchise_aliases: h.franchise_aliases,
              providers: h.providers,
              provider_names: h.provider_names,
              year: h.year,
              search_rank: h.search_rank,
              is_special: h.is_special,
              is_spin_off: h.is_spin_off,
            })),
          });
        } catch (e: any) {
          out.push({ q, error: e?.message || String(e) });
        }
      }
      return json({ ok: true, results: out });
    }


    // ── Admin-only Search QA Audit ───────────────────────────────────────
    // Runs a battery of golden/regression checks directly against Meili
    // and reports an issue list. Not exposed publicly; admin JWT or
    // x-hapl-sync-token required (enforced by authorize() above).
    if (action === "qa_audit") {
      type Issue = {
        severity: "P0" | "P1" | "P2";
        check: string;
        query: string;
        expected: string;
        actual: string;
        reason: string;
        suggested_fix: string;
      };
      const issues: Issue[] = [];
      const summary: any[] = [];

      const normalize = (s: string): string => {
        const TR: Record<string,string> = { ı:"i", İ:"i", ş:"s", Ş:"s", ğ:"g", Ğ:"g", ü:"u", Ü:"u", ö:"o", Ö:"o", ç:"c", Ç:"c" };
        let out = ""; for (const ch of s || "") out += TR[ch] ?? ch;
        return out.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
      };
      const stripArticle = (s: string): string | null => {
        const m = (s || "").match(/^\s*(the|a|an)\s+(.+)$/i);
        return m ? m[2].trim() : null;
      };
      const isLatin = (s: string): boolean => {
        if (!s) return false;
        const NL = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\u0600-\u06ff\u0590-\u05ff\u0400-\u04ff\u0900-\u097f\u0e00-\u0e7f\u0370-\u03ff]/;
        return !NL.test(s);
      };

      const runSearch = async (q: string, limit = 5) => {
        try {
          const r = await searchMeili({ q, limit }, cfg);
          return r.hits;
        } catch { return []; }
      };

      // Golden checks: query → must be top-1 by canonical title match
      const golden: Array<{ q: string; expectTitleContains: string; severity?: "P0"|"P1" }> = [
        { q: "white lotus",          expectTitleContains: "white lotus", severity: "P0" },
        { q: "the white lotus",      expectTitleContains: "white lotus", severity: "P0" },
        { q: "goodfellas",           expectTitleContains: "goodfellas",  severity: "P0" },
        { q: "friends",              expectTitleContains: "friends",     severity: "P0" },
        { q: "ice age",              expectTitleContains: "ice age",     severity: "P1" },
        { q: "buz devri",            expectTitleContains: "ice age",     severity: "P1" },
        { q: "shrek",                expectTitleContains: "shrek",       severity: "P1" },
        { q: "şrek",                 expectTitleContains: "shrek",       severity: "P1" },
        { q: "fast and furious",     expectTitleContains: "fast",        severity: "P1" },
        { q: "hızlı ve öfkeli",      expectTitleContains: "fast",        severity: "P1" },
        { q: "lord of the rings",    expectTitleContains: "lord of the rings", severity: "P1" },
        { q: "yüzüklerin efendisi",  expectTitleContains: "lord of the rings", severity: "P1" },
        { q: "money heist",          expectTitleContains: "money heist", severity: "P1" },
        { q: "la casa de papel",     expectTitleContains: "money heist", severity: "P1" },
      ];

      for (const g of golden) {
        const hits = await runSearch(g.q, 5);
        const top = hits[0];
        const topTitleN = normalize(top?.title || "");
        const ok = top && topTitleN.includes(normalize(g.expectTitleContains));
        summary.push({
          check: "golden",
          query: g.q,
          top: top ? { title: top.title, year: top.year, search_rank: top.search_rank } : null,
          ok,
        });
        if (!ok) {
          issues.push({
            severity: g.severity || "P1",
            check: "golden",
            query: g.q,
            expected: `top-1 title contains "${g.expectTitleContains}"`,
            actual: top ? `${top.title} (${top.year})` : "no_results",
            reason: "top-1 mismatch",
            suggested_fix: "verify document english_title / exact_aliases / article_stripped_aliases; check search_rank for the expected doc",
          });
        }
      }

      // article_stripped parity: "white lotus" and "the white lotus" same top-1
      {
        const a = await runSearch("white lotus", 1);
        const b = await runSearch("the white lotus", 1);
        const ok = a[0]?.id && b[0]?.id && a[0].id === b[0].id;
        summary.push({ check: "article_stripped", a: a[0]?.title, b: b[0]?.title, ok });
        if (!ok) issues.push({
          severity: "P0", check: "article_stripped", query: "white lotus | the white lotus",
          expected: "same top-1 doc", actual: `${a[0]?.title} | ${b[0]?.title}`,
          reason: "article-stripped retry not surfacing same doc",
          suggested_fix: "ensure article_stripped_aliases populated and runMeili retry path is active",
        });
      }

      // alias_collision: goodfellas top-1 must NOT be Friends
      {
        const hits = await runSearch("goodfellas", 3);
        const top = hits[0];
        const ok = top && !normalize(top.title || "").includes("friends");
        summary.push({ check: "alias_collision", top: top?.title, ok });
        if (!ok) issues.push({
          severity: "P0", check: "alias_collision", query: "goodfellas",
          expected: "GoodFellas top-1, NOT Friends",
          actual: top?.title || "—",
          reason: "Sıkı Dostlar alias collided across docs",
          suggested_fix: "ensure localized_title_tr is doc-specific exact_alias not global synonym",
        });
      }

      // Snow White must NOT outrank The White Lotus on "white lotus"
      {
        const hits = await runSearch("white lotus", 5);
        const top = hits[0];
        const ok = top && normalize(top.title || "").includes("white lotus");
        summary.push({ check: "white_lotus_coverage", top: top?.title, ok });
        if (!ok) issues.push({
          severity: "P0", check: "coverage_guard", query: "white lotus",
          expected: "White Lotus top-1, not Snow White / Thomas & Friends-style single-word match",
          actual: top?.title || "—",
          reason: "multi-token coverage guard not strong enough",
          suggested_fix: "verify tryMeiliBranch coverage requireCoverage>=2 path",
        });
      }

      // non_latin_display: scan a sample of docs to ensure card title is Latin
      // when origin != yerli.
      {
        const sample = await searchMeili({ q: "", limit: 200, filter: "available_in_tr = true" }, cfg);
        let bad = 0; const examples: any[] = [];
        for (const h of sample.hits) {
          if ((h as any).origin === "yerli") continue;
          if (!isLatin(h.title || "")) {
            bad++;
            if (examples.length < 5) examples.push({ id: h.id, title: h.title, original_title: h.original_title, english_title: (h as any).english_title });
          }
        }
        summary.push({ check: "non_latin_display", scanned: sample.hits.length, bad, examples });
        if (bad > 0) issues.push({
          severity: "P1", check: "non_latin_display", query: "(sample 200)",
          expected: "0 foreign docs with non-Latin display title",
          actual: `${bad} doc(s) still showing non-Latin title`,
          reason: "pickDisplayTitle did not find a Latin candidate",
          suggested_fix: "hydrate aliases (en TMDB translation / US alt_title) for affected docs; ensure pickDisplayTitle covers them",
        });
      }

      // provider_badge: top-1 of goodfellas / friends has providers
      for (const q of ["goodfellas", "friends"]) {
        const hits = await runSearch(q, 1);
        const top = hits[0];
        const ok = top && (top.providers?.length ?? 0) > 0;
        summary.push({ check: "provider_badge", query: q, providers: top?.providers, ok });
        if (!ok) issues.push({
          severity: "P1", check: "provider_badge", query: q,
          expected: "≥1 provider slug on top-1",
          actual: JSON.stringify(top?.providers || []),
          reason: "top hit has no providers",
          suggested_fix: "check content_availability row + sync joined providers correctly",
        });
      }

      // typeahead_full_parity: short-form vs full-form parity on key queries
      for (const q of ["friend", "good", "shre"]) {
        const ta = await runSearch(q, 3);
        const expectMap: Record<string, string> = { friend: "friends", good: "goodfellas", shre: "shrek" };
        const expect = expectMap[q];
        const ok = ta.some((h) => normalize(h.title || "").includes(expect));
        summary.push({ check: "typeahead_parity", query: q, ok, top: ta[0]?.title });
        if (!ok) issues.push({
          severity: "P2", check: "typeahead_parity", query: q,
          expected: `${expect} surfaces in top-3 for prefix`,
          actual: ta[0]?.title || "—",
          reason: "prefix match did not produce canonical hit",
          suggested_fix: "verify Meili typo tolerance + prefix indexing on title/english_title",
        });
      }

      const counts = {
        P0: issues.filter(i => i.severity === "P0").length,
        P1: issues.filter(i => i.severity === "P1").length,
        P2: issues.filter(i => i.severity === "P2").length,
      };
      return json({ ok: true, action: "qa_audit", counts, issues, summary, ts: new Date().toISOString() });
    }




    if (action === "reset_index") {
      // Delete the Meili index, recreate settings, reset our state row.
      const del = await deleteIndex(cfg);
      let delTask: any = null;
      if (del.taskUid !== -1) {
        delTask = await waitForTask(del.taskUid, cfg, { timeoutMs: 20000 });
      }
      const setup = await ensureIndexSettings(cfg);
      const state = await upsertState(sb, cfg.indexName, {
        indexed_count: 0,
        failed_count: 0,
        current_offset: 0,
        total_titles: 0,
        has_more: false,
        last_error: null,
        last_synced_at: null,
        meta: { last_reset_at: new Date().toISOString() },
      });
      return json({ ok: true, deleted_task: delTask, setup, state });
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
      let taskInfo: any = null;
      let taskError: string | null = null;
      if (batch.docs.length > 0) {
        try {
          const r = await upsertDocuments(batch.docs, cfg);
          // 202 is NOT success — poll the task to confirm Meili actually
          // ingested the documents. invalid_document_id and friends only
          // surface here.
          const t = await waitForTask(r.taskUid, cfg, { timeoutMs: 20000 });
          taskInfo = { taskUid: r.taskUid, status: t.status };
          if (t.status === "succeeded") {
            pushed = r.count;
          } else if (t.status === "failed" || t.status === "canceled") {
            failed = batch.docs.length;
            taskError = `meili task ${t.status}: ${t.error?.code || ""} ${t.error?.message || ""}`.trim();
          } else {
            // still processing after timeout — count as failed for this run
            // (don't double-advance), but record the task uid for inspection.
            failed = batch.docs.length;
            taskError = `meili task still ${t.status} after timeout (uid=${r.taskUid})`;
          }
        } catch (e: any) {
          failed = batch.docs.length;
          taskError = `meili upsert failed: ${e?.message || String(e)}`;
        }
      }

      const nextOffset = offset + batch.titleCount;
      const newState = await upsertState(sb, cfg.indexName, {
        current_offset: nextOffset,
        indexed_count: (state.indexed_count || 0) + pushed,
        failed_count: (state.failed_count || 0) + failed,
        has_more: batch.hasMore,
        last_synced_at: new Date().toISOString(),
        last_error: taskError,
      });

      return json({
        ok: !taskError,
        action: "full_sync_continue",
        batch_size: batchSize,
        titles_scanned: batch.titleCount,
        docs_pushed: pushed,
        docs_failed: failed,
        task: taskInfo,
        task_error: taskError,
        next_offset: nextOffset,
        has_more: batch.hasMore,
        state: newState,
      });
    }

    // Loop many batches in one HTTP call until deadline or done.
    if (action === "full_sync_run") {
      const maxMs = Math.min(Number(body?.max_ms) || 90000, 110000);
      const deadline = Date.now() + maxMs;
      let totalPushed = 0, totalFailed = 0, batches = 0;
      let lastTaskError: string | null = null;
      let stop = false;
      while (Date.now() < deadline && !stop) {
        const state = (await loadState(sb, cfg.indexName)) || { current_offset: 0, indexed_count: 0, failed_count: 0 };
        const offset = Number(state.current_offset) || 0;
        let batch;
        try {
          batch = await collectBatch(sb, offset, batchSize);
        } catch (e: any) {
          lastTaskError = `collect failed: ${e?.message || String(e)}`;
          await upsertState(sb, cfg.indexName, { last_error: lastTaskError });
          break;
        }
        let pushed = 0, failed = 0;
        if (batch.docs.length > 0) {
          try {
            const r = await upsertDocuments(batch.docs, cfg);
            const t = await waitForTask(r.taskUid, cfg, { timeoutMs: 20000 });
            if (t.status === "succeeded") pushed = r.count;
            else { failed = batch.docs.length; lastTaskError = `task ${t.status}: ${t.error?.code || ""} ${t.error?.message || ""}`.trim(); }
          } catch (e: any) {
            failed = batch.docs.length;
            lastTaskError = `meili upsert failed: ${e?.message || String(e)}`;
          }
        }
        const nextOffset = offset + batch.titleCount;
        await upsertState(sb, cfg.indexName, {
          current_offset: nextOffset,
          indexed_count: (state.indexed_count || 0) + pushed,
          failed_count: (state.failed_count || 0) + failed,
          has_more: batch.hasMore,
          last_synced_at: new Date().toISOString(),
          last_error: lastTaskError,
        });
        totalPushed += pushed; totalFailed += failed; batches++;
        if (!batch.hasMore) stop = true;
      }
      const finalState = await loadState(sb, cfg.indexName);
      return json({
        ok: !lastTaskError,
        action: "full_sync_run",
        batches,
        docs_pushed: totalPushed,
        docs_failed: totalFailed,
        last_error: lastTaskError,
        state: finalState,
      });
    }


    // ── Faz 3: Meili dirty consumer ──────────────────────────────────────
    // Claims a batch of pending catalog_dirty_titles rows, rebuilds Meili
    // documents for them, upserts to Meili, and marks each row as processed
    // (or increments attempts + records last_error on failure). Also clears
    // the search_cache so refreshed availability isn't masked by stale rows.
    if (action === "sync_dirty_titles" || action === "process_dirty") {
      if (!isMeiliConfigured(cfg)) {
        return json({ ok: false, error: "Meilisearch not configured" }, 400);
      }
      const limit = Math.max(1, Math.min(200, Number(body?.limit) || 50));
      const owner = `edge:${crypto.randomUUID().slice(0, 8)}`;

      // Atomically claim pending rows
      const { data: claimed, error: claimErr } = await sb.rpc("claim_dirty_titles", {
        p_limit: limit,
        p_owner: owner,
      });
      if (claimErr) {
        return json({ ok: false, error: `claim failed: ${claimErr.message}` }, 500);
      }
      const rows = (claimed || []) as Array<{ id: string; title_id: string; attempts: number }>;
      if (rows.length === 0) {
        return json({ ok: true, claimed: 0, processed: 0, failed: 0, message: "no pending dirty titles" });
      }

      const titleIds = rows.map((r) => r.title_id);

      // Build docs only for these specific titles. We mirror collectBatch()
      // but constrained to titleIds and without the poster_path filter so a
      // title that lost its poster still gets re-upserted (Meili setting may
      // include filters that drop it, but the upsert itself remains idempotent).
      const buildDocsForTitles = async (ids: string[]): Promise<{ docsByTitle: Map<string, MeiliDoc> }> => {
        const out = new Map<string, MeiliDoc>();
        if (ids.length === 0) return { docsByTitle: out };

        const { data: titles, error: titleErr } = await sb
          .from("content_titles")
          .select(
            "id, tmdb_id, tmdb_type, title, original_title, normalized_title, release_year, poster_path, backdrop_path, genres, content_kind, metadata, updated_at",
          )
          .in("id", ids);
        if (titleErr) throw new Error(`titles fetch failed: ${titleErr.message}`);
        const titleRows = titles || [];

        const { data: availRows } = await sb
          .from("content_availability")
          .select("title_id, provider_id, status, source, confidence, availability_type")
          .in("title_id", ids)
          .eq("region", "TR")
          .eq("status", "available")
          .in("availability_type", ELIGIBLE_AVAILABILITY_TYPES as unknown as string[])
          .gte("confidence", ELIGIBLE_MIN_CONFIDENCE);
        const availByTitle = new Map<string, any[]>();
        for (const a of availRows || []) {
          if (!isEligibleAvail(a)) continue; // belt + suspenders
          const arr = availByTitle.get(a.title_id) || [];
          arr.push(a);
          availByTitle.set(a.title_id, arr);
        }
        const providerIds = Array.from(new Set((availRows || []).map((a: any) => a.provider_id)));
        const providerById = new Map<string, any>();
        if (providerIds.length > 0) {
          const { data: provs } = await sb
            .from("streaming_providers")
            .select("id, slug, display_name")
            .in("id", providerIds);
          for (const p of provs || []) providerById.set(p.id, p);
        }

        const movieIds = titleRows.filter((t: any) => t.tmdb_type === "movie").map((t: any) => t.tmdb_id);
        const tvIds = titleRows.filter((t: any) => t.tmdb_type === "tv").map((t: any) => t.tmdb_id);
        const aliasTasks: Promise<any>[] = [];
        if (movieIds.length > 0) {
          aliasTasks.push(
            sb.from("content_title_aliases")
              .select("tmdb_id, tmdb_type, alias, source, language, country")
              .eq("tmdb_type", "movie").in("tmdb_id", movieIds),
          );
        }
        if (tvIds.length > 0) {
          aliasTasks.push(
            sb.from("content_title_aliases")
              .select("tmdb_id, tmdb_type, alias, source, language, country")
              .eq("tmdb_type", "tv").in("tmdb_id", tvIds),
          );
        }
        const aliasRes = await Promise.all(aliasTasks);
        const aliasByKey = new Map<string, any[]>();
        for (const r of aliasRes) {
          for (const row of r.data || []) {
            const key = `${row.tmdb_type}:${row.tmdb_id}`;
            const arr = aliasByKey.get(key) || [];
            arr.push({ alias: row.alias, source: row.source ?? null, language: row.language ?? null, country: row.country ?? null });
            aliasByKey.set(key, arr);
          }
        }

        for (const t of titleRows) {
          const avails = availByTitle.get(t.id) || [];
          const aliases = aliasByKey.get(`${t.tmdb_type}:${t.tmdb_id}`) || [];
          // Faz 4: never skip — when avails is empty we still emit a tombstone
          // doc. mapContentTitleToMeiliDocument with empty avails naturally
          // produces providers=[], provider_names=[], available_in_tr=false,
          // confidence=0 — which is exactly the tombstone shape.
          out.set(t.id, mapContentTitleToMeiliDocument(t, aliases, avails, providerById));
        }
        return { docsByTitle: out };
      };


      let docsByTitle: Map<string, MeiliDoc>;
      try {
        const built = await buildDocsForTitles(titleIds);
        docsByTitle = built.docsByTitle;
      } catch (e: any) {
        // Release the claim by clearing processing_at so they get retried; do
        // NOT bump attempts (claim itself didn't fail per-title).
        await sb.from("catalog_dirty_titles")
          .update({ processing_at: null, processing_owner: null })
          .in("id", rows.map((r) => r.id));
        return json({ ok: false, error: `build failed: ${e?.message || String(e)}` }, 500);
      }

      // Upsert docs (single Meili task) and wait
      let upsertErr: string | null = null;
      const docs = Array.from(docsByTitle.values());
      if (docs.length > 0) {
        try {
          const r = await upsertDocuments(docs, cfg);
          const t = await waitForTask(r.taskUid, cfg, { timeoutMs: 20000 });
          if (t.status !== "succeeded") {
            upsertErr = `meili task ${t.status}: ${t.error?.code || ""} ${t.error?.message || ""}`.trim();
          }
        } catch (e: any) {
          upsertErr = `meili upsert failed: ${e?.message || String(e)}`;
        }
      }

      // Mark rows: success if its title was upserted OR had no docs (no TR
      // availability) — the latter is a legitimate no-op. Failure if the
      // Meili task failed overall.
      const nowIso = new Date().toISOString();
      let processed = 0;
      let failed = 0;
      if (upsertErr) {
        const ids = rows.map((r) => r.id);
        // bump attempts + record error, release processing lock
        for (const r of rows) {
          await sb.from("catalog_dirty_titles")
            .update({
              attempts: (r.attempts || 0) + 1,
              last_error: upsertErr.slice(0, 500),
              processing_at: null,
              processing_owner: null,
            })
            .eq("id", r.id);
          failed++;
        }
      } else {
        for (const r of rows) {
          await sb.from("catalog_dirty_titles")
            .update({
              processed_at: nowIso,
              last_error: null,
              processing_at: null,
              processing_owner: null,
            })
            .eq("id", r.id);
          processed++;
        }
      }

      // Cache invalidation: dirty processing implies catalog changed, so
      // blanket-clear search_cache. Response shape unaffected; cache rebuilds
      // on next query.
      let cacheCleared = 0;
      if (!upsertErr && processed > 0) {
        const { count, error: delErr } = await sb
          .from("search_cache")
          .delete({ count: "exact" })
          .gt("created_at", "1970-01-01");
        if (!delErr) cacheCleared = count || 0;
      }

      return json({
        ok: !upsertErr,
        action: "sync_dirty_titles",
        claimed: rows.length,
        docs_upserted: docs.length,
        processed,
        failed,
        upsert_error: upsertErr,
        cache_cleared: cacheCleared,
      });
    }

    // ── Faz 4: backfill ineligible tombstones (admin-only, manual) ──────
    // Scans Meili for docs with available_in_tr=true whose DB rows no longer
    // satisfy eligibility, and tombstones them (no delete). Batched + paged.
    // dry_run=true reports counts + sample without writing.
    if (action === "backfill_ineligible_tombstones") {
      if (!isMeiliConfigured(cfg)) {
        return json({ ok: false, error: "Meilisearch not configured" }, 400);
      }
      const dryRun = body?.dry_run !== false; // default to dry_run=true for safety
      const pageLimit = Math.max(50, Math.min(1000, Number(body?.page_limit) || 500));
      const maxPages = Math.max(1, Math.min(50, Number(body?.max_pages) || 10));

      let scanned = 0;
      let candidates = 0;
      let tombstoned = 0;
      let failed = 0;
      const sample: Array<{ id: string; title: string; tmdb_id: number }> = [];
      let lastError: string | null = null;

      try {
        // Cursor-based pagination. When dry_run, advance offset by page size.
        // When applying, advance only by the *non-tombstoned* count — the
        // tombstoned docs flip available_in_tr → false and disappear from the
        // filter, so the next page-from-cursor naturally surfaces the next
        // suspects. Idempotent: re-running converges at 0 candidates.
        let cursor = 0;
        for (let page = 0; page < maxPages; page++) {
          const fetched = await fetch(`${cfg.host}/indexes/${cfg.indexName}/documents/fetch`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${cfg.masterKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              filter: "available_in_tr = true",
              limit: pageLimit,
              offset: cursor,
              fields: ["id", "tmdb_id", "type", "title"],
            }),
          });
          if (!fetched.ok) {
            lastError = `meili fetch page ${page} failed: ${fetched.status} ${await fetched.text()}`;
            break;
          }
          const payload = await fetched.json();
          const results: Array<{ id: string; tmdb_id: number; type: string; title: string }> = payload?.results || [];
          if (results.length === 0) break;
          scanned += results.length;

          // Look up DB title rows by (tmdb_type, tmdb_id) to get internal ids
          const movieTmdbIds = results.filter((r) => r.type === "movie").map((r) => r.tmdb_id);
          const tvTmdbIds = results.filter((r) => r.type === "tv").map((r) => r.tmdb_id);
          const titleLookup = new Map<string, { id: string; tmdb_id: number; tmdb_type: string }>();
          for (const [type, ids] of [["movie", movieTmdbIds], ["tv", tvTmdbIds]] as const) {
            if (ids.length === 0) continue;
            const CHUNK = 200;
            for (let i = 0; i < ids.length; i += CHUNK) {
              const slice = ids.slice(i, i + CHUNK);
              const { data: rows } = await sb
                .from("content_titles")
                .select("id, tmdb_id, tmdb_type")
                .eq("tmdb_type", type)
                .in("tmdb_id", slice);
              for (const r of rows || []) titleLookup.set(`${r.tmdb_type}:${r.tmdb_id}`, r);
            }
          }

          const dbIds = Array.from(titleLookup.values()).map((t) => t.id);
          const eligibleSet = new Set<string>();
          if (dbIds.length > 0) {
            const CHUNK = 300;
            for (let i = 0; i < dbIds.length; i += CHUNK) {
              const slice = dbIds.slice(i, i + CHUNK);
              const { data: rows } = await applyEligibilityFilter(
                sb.from("content_availability")
                  .select("title_id, status, availability_type, confidence"),
              ).in("title_id", slice);
              for (const a of rows || []) {
                if (isEligibleAvail(a as any)) eligibleSet.add((a as any).title_id);
              }
            }
          }

          // Build tombstone candidates per page
          const tombstoneTitleIds: string[] = [];
          let pageCandidates = 0;
          for (const r of results) {
            const dbRow = titleLookup.get(`${r.type}:${r.tmdb_id}`);
            if (!dbRow) {
              candidates++;
              pageCandidates++;
              if (sample.length < 25) sample.push({ id: r.id, title: r.title, tmdb_id: r.tmdb_id });
              continue;
            }
            if (!eligibleSet.has(dbRow.id)) {
              candidates++;
              pageCandidates++;
              tombstoneTitleIds.push(dbRow.id);
              if (sample.length < 25) sample.push({ id: r.id, title: r.title, tmdb_id: r.tmdb_id });
            }
          }

          let pageTombstoned = 0;
          if (!dryRun && tombstoneTitleIds.length > 0) {
            const { data: tRows } = await sb
              .from("content_titles")
              .select("id, tmdb_id, tmdb_type, title, original_title, normalized_title, release_year, poster_path, backdrop_path, genres, content_kind, metadata, updated_at")
              .in("id", tombstoneTitleIds);
            const tombDocs: MeiliDoc[] = [];
            for (const t of tRows || []) {
              tombDocs.push(mapContentTitleToMeiliDocument(t as any, [], [], new Map()));
            }
            if (tombDocs.length > 0) {
              try {
                const r = await upsertDocuments(tombDocs, cfg);
                const task = await waitForTask(r.taskUid, cfg, { timeoutMs: 30000 });
                if (task.status !== "succeeded") {
                  failed += tombDocs.length;
                  lastError = `meili task ${task.status}: ${task.error?.code || ""} ${task.error?.message || ""}`.trim();
                } else {
                  tombstoned += tombDocs.length;
                  pageTombstoned = tombDocs.length;
                }
              } catch (e: any) {
                failed += tombDocs.length;
                lastError = `meili upsert failed: ${e?.message || String(e)}`;
              }
            }
          }

          // Advance cursor by results that REMAIN under the filter on next
          // page-fetch. When applying, tombstoned docs disappear from filter
          // results, so we keep cursor on still-eligible rows only. When
          // dry-run, nothing changes, so we must advance by full page size.
          if (dryRun) {
            cursor += results.length;
          } else {
            cursor += Math.max(0, results.length - pageTombstoned);
          }

          if (results.length < pageLimit) break;
        }
      } catch (e: any) {
        lastError = `backfill fatal: ${e?.message || String(e)}`;
      }


      // Cache invalidation if anything was tombstoned
      let cacheCleared = 0;
      if (!dryRun && tombstoned > 0) {
        const { count } = await sb
          .from("search_cache")
          .delete({ count: "exact" })
          .gt("created_at", "1970-01-01");
        cacheCleared = count || 0;
      }

      return json({
        ok: !lastError,
        action: "backfill_ineligible_tombstones",
        dry_run: dryRun,
        scanned,
        candidates,
        tombstoned,
        failed,
        cache_cleared: cacheCleared,
        sample_titles: sample,
        last_error: lastError,
      });
    }

    // ── Faz 3: dirty queue stats (admin panel) ──────────────────────────
    if (action === "dirty_stats") {

      const [openRes, failedRes, processedRes] = await Promise.all([
        sb.from("catalog_dirty_titles").select("id", { count: "exact", head: true })
          .is("processed_at", null).lt("attempts", 5),
        sb.from("catalog_dirty_titles").select("id", { count: "exact", head: true })
          .is("processed_at", null).gte("attempts", 5),
        sb.from("catalog_dirty_titles").select("processed_at")
          .not("processed_at", "is", null)
          .order("processed_at", { ascending: false }).limit(1),
      ]);
      const lastErr = await sb.from("catalog_dirty_titles")
        .select("last_error, attempts, title_id")
        .not("last_error", "is", null)
        .is("processed_at", null)
        .order("attempts", { ascending: false })
        .limit(1)
        .maybeSingle();
      return json({
        ok: true,
        open_count: openRes.count || 0,
        failed_count: failedRes.count || 0,
        last_processed_at: processedRes.data?.[0]?.processed_at || null,
        last_error: lastErr.data || null,
      });
    }

    return json({ ok: false, error: `unknown action: ${action}` }, 400);

  } catch (e: any) {
    console.error("[hapl-sync-search-index] fatal:", e);
    return json({ ok: false, error: e?.message || String(e) }, 500);
  }
});
