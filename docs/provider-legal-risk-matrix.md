# Provider Legal & ToS Risk Matrix

Internal risk register for connector decisions. Owned by Hapl team.
Re-check on a quarterly cadence or when a provider updates ToS.

| provider_slug | provider_name | terms_url | robots_url | public_catalog_url | login_required | automated_access_clause | content_copy_clause | connector_risk | connector_decision | notes | checked_at |
|---|---|---|---|---|---|---|---|---|---|---|---|
| tmdb | TMDB | https://www.themoviedb.org/terms-of-use | https://www.themoviedb.org/robots.txt | https://www.themoviedb.org/ | no | API allowed under Terms + attribution | poster/image use requires attribution | low–medium | allowed | API-only via TMDB_API_TOKEN. Attribution mandatory. Track commercial-use clause. | 2026-05-13 |
| tabii | tabii | https://www.tabii.com/tr/legal/terms | https://www.tabii.com/robots.txt | https://www.tabii.com/tr | yes | Robots/spiders/scrapers explicitly forbidden | content reuse restricted | high | blocked | No production connector without written permission or public API. | 2026-05-13 |
| gain | GAIN | https://gain.tv/sozlesmeler/uyelik-sozlesmesi | https://gain.tv/robots.txt | https://gain.tv/ | yes | Bots / data scraping / extraction forbidden in membership terms | content reuse restricted | high | blocked | No production connector without permission. | 2026-05-13 |
| puhutv | PuhuTV | https://puhutv.com/kullanim-kosullari | https://puhutv.com/robots.txt | https://puhutv.com/ | partial | Restrictive on automated use | broad limits on materials | medium–high | needs_permission | Legal/technical preflight before any connector. | 2026-05-13 |
| exxen | EXXEN | https://www.exxen.com/uyelik-sozlesmesi | https://www.exxen.com/robots.txt | https://www.exxen.com/ | yes | Membership-gated | catalog mostly behind paywall | high | manual_only | TMDB + manual for now; no connector. | 2026-05-13 |
| tod-tv | TOD | https://tod.tv/tr/yardim/sozlesmeler | https://tod.tv/robots.txt | https://tod.tv/tr | yes | Membership-gated, mixed VOD + live sports | restrictive | medium–high | manual_only | TMDB provider-targeted + manual. Low priority. | 2026-05-13 |
| bein-connect | beIN CONNECT | https://www.beinconnect.com.tr/yardim/sozlesmeler | https://www.beinconnect.com.tr/robots.txt | https://www.beinconnect.com.tr/ | yes | Membership-gated, live sports heavy | restrictive | high | blocked | No connector, low priority. | 2026-05-13 |
| tv-plus | TV+ | https://www.tvplus.com.tr/sozlesmeler | https://www.tvplus.com.tr/robots.txt | https://www.tvplus.com.tr/ | yes | Subscription-based | restrictive | medium | manual_only | TMDB + HBO Max → TV+ derivation rule covers most cases. | 2026-05-13 |

## Connector policy (binding)

When a connector is approved (decision = `allowed`), it must:

- Not authenticate / log in to the provider.
- Not fetch content behind a membership/paywall.
- Not download video, stream URLs, subtitles, or poster files.
- Not copy long descriptions / synopses / reviews.
- Write only minimal metadata + availability.
- Always populate `source_url`.
- Keep `raw_payload` minimal — evidence only.
- Set `source = 'provider_catalog'`.
- Only write **positive** evidence; never auto-flip to `unavailable`.
- Apply low rate limits and respect `robots.txt`.
- Expose a takedown / manual-correction path.

## Decision legend

- `allowed` — connector may run in production.
- `manual_only` — admin form / TMDB only.
- `needs_permission` — paused until written/legal sign-off.
- `blocked` — do not build a connector.
