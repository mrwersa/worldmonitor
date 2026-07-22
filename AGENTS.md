# AGENTS.md

Agent entry point for WorldMonitor. Read this first, then follow links for depth.

## What This Project Is

Real-time global intelligence dashboard. TypeScript SPA (Vite + Preact) with 163 top-level TypeScript component files, 80+ Vercel Edge API endpoint entries, a Tauri desktop app with Node.js sidecar, and a Railway relay service. Aggregates geopolitics, military, finance, climate, cyber, maritime, and aviation data across 35 freshness-tracked source groups.

## Repository Map

```
.
├── src/                    # Browser SPA (TypeScript, class-based components)
│   ├── app/                # App orchestration (data-loader, refresh-scheduler, panel-layout)
│   ├── bootstrap/          # Startup/recovery (chunk reload, deferred Sentry, SW update)
│   ├── components/         # 163 top-level TypeScript component files
│   ├── config/             # Variant configs, panel/layer definitions, market symbols
│   ├── services/           # Business logic (200 service modules and domain directories)
│   ├── shared/             # Cross-cutting helpers (premium paths, registries, staleness)
│   ├── embed/              # Embeddable widget loader
│   ├── styles/             # Global CSS (layers, themes, panel styles)
│   ├── shims/              # Runtime shims (child-process for sidecar)
│   ├── data/               # Static JSON datasets (conservation, renewable, happiness)
│   ├── e2e/                # Map test harnesses (consumed by Playwright specs)
│   ├── types/              # TypeScript type definitions
│   ├── utils/              # Shared utilities (circuit-breaker, theme, URL state, DOM)
│   ├── workers/            # Web Workers (analysis, ML/ONNX, vector DB)
│   ├── generated/          # Proto-generated client/server stubs (DO NOT EDIT)
│   ├── locales/            # i18n translation files
│   └── App.ts              # Main application entry
├── api/                    # Vercel Edge Functions (plain JS, self-contained)
│   ├── _*.js               # Shared helpers (CORS, rate-limit, API key, relay)
│   ├── health.js           # Health check endpoint
│   ├── bootstrap.js        # Bulk data hydration endpoint
│   └── <domain>/           # Domain-specific endpoints (aviation/, climate/, etc.)
├── server/                 # Server-side shared code (used by Edge Functions)
│   ├── _shared/            # Redis, rate-limit, LLM, caching, response headers
│   ├── gateway.ts          # Domain gateway factory (CORS, auth, cache tiers)
│   ├── router.ts           # Route matching
│   └── worldmonitor/       # Domain handlers (mirrors proto service structure)
├── proto/                  # Protobuf definitions (sebuf framework)
│   ├── buf.yaml            # Buf configuration
│   └── worldmonitor/       # Service definitions with HTTP annotations
├── shared/                 # Cross-platform data (JSON configs for markets, RSS domains)
├── data/                   # Static data (telegram channels, OREF threat translations, gamma irradiators)
├── public/                 # Static assets served as-is (favicons, textures, .well-known, llms.txt)
├── scripts/                # Seed scripts, build helpers, data fetchers
├── src-tauri/              # Tauri desktop shell (Rust + Node.js sidecar)
│   └── sidecar/            # Node.js sidecar API server
├── consumer-prices-core/   # Consumer-price scrapers (Playwright, per-country baskets; Railway/Docker)
├── workers/                # Cloudflare Workers (edge CORS preflight for api.worldmonitor.app)
├── tests/                  # Unit/integration tests (node:test runner)
├── e2e/                    # Playwright E2E specs
├── pro-test/               # Standalone Pro QA app (separate package)
├── docs/                   # Mintlify documentation site
│   └── solutions/          # Documented solutions to past problems (bugs, patterns, practices) — YAML frontmatter (module, tags, problem_type)
├── docker/                 # Docker build for Railway services
├── deploy/                 # Deployment configs (nginx)
├── CONCEPTS.md             # Shared domain vocabulary (entities, named processes, status concepts)
└── blog-site/              # Static blog (built into public/blog/)
```

## How to Run

```bash
npm ci                   # Deterministic install (also runs blog-site postinstall)
npm run dev              # Start Vite dev server (full variant)
npm run dev:tech         # Start tech-only variant
npm run dev:energy       # Start energy-security variant
npm run typecheck        # tsc --noEmit (strict mode)
npm run typecheck:api    # Typecheck API layer separately
npm run test:data        # Run unit/integration tests
npm run test:sidecar     # Run sidecar + API handler tests
npm run test:e2e         # Run all Playwright E2E tests
make generate            # Regenerate proto stubs + per-service & unified OpenAPI specs (requires buf + sebuf v0.11.1 plugins)
npm run worktree:bootstrap          # Fresh worktree: link local env files + npm ci with tmp cache
npm run worktree:bootstrap:test-only # Fresh docs/test worktree: same, but npm ci --ignore-scripts
npm run worktree:env                # Link ignored local env files only
```

## Fresh Worktree Bootstrap

Worktrees usually start without ignored local state. When creating or entering one:

1. Start from `origin/main` or the requested base, not a dirty local branch.
2. Run `npm run worktree:bootstrap` before typecheck/tests. The helper links ignored `.env.local` / `.env` from the main worktree when Git can infer it, and installs deps with `npm ci --cache /tmp/worldmonitor-npm-cache`.
3. If only docs/test tooling is needed and native postinstall work is unnecessary, use `npm run worktree:bootstrap:test-only`.
4. If live credentials are unavailable, do not fabricate secrets. Run the non-credentialed checks you can and report the credential gate explicitly.

Env rules:

- Link only `.env.local` and `.env`. Never copy or link `.env.vercel-backup` or `.env.vercel-export`; the pre-push guard blocks those files even as symlinks.
- Override env source discovery with `WM_ENV_SOURCE=/path/to/worldmonitor npm run worktree:env` when the main worktree cannot be inferred.
- `.env*` files are ignored local state. Do not add, print, or summarize secret values.

Validation hygiene:

- Prefer `npm ci` over `npm install` in fresh worktrees. Use `npm_config_cache=/tmp/worldmonitor-npm-cache` for `npx` or install commands if cache ownership errors appear.
- After bootstrap or pre-push, run `git status --short`. If dependency bootstrap changed lockfiles you did not intend to edit, remove those incidental changes before finalizing.
- After install, prefer local tools such as `./node_modules/.bin/tsx --test ...` for focused TypeScript tests when `npx` is flaky.

## Architecture Rules

### Dependency Direction

```
types -> config -> services -> components -> app -> App.ts
```

- `types/` has zero internal imports
- `config/` imports only from `types/`
- `services/` imports from `types/` and `config/`
- `components/` imports from all above
- `app/` orchestrates components and services

### API Layer Constraints

- `api/*.js` are Vercel Edge Functions: **self-contained JS only**
- They CANNOT import from `../src/` or `../server/` (different runtime)
- Only same-directory `_*.js` helpers and npm packages
- Enforced by `tests/edge-functions.test.mjs` and pre-push hook esbuild check

### Server Layer

- `server/` code is bundled INTO Edge Functions at deploy time via gateway
- `server/_shared/` contains Redis client, rate limiting, LLM helpers
- `server/worldmonitor/<domain>/` has RPC handlers matching proto services
- All handlers use `cachedFetchJson()` for Redis caching with stampede protection

### Proto Contract Flow

```
proto/ definitions -> buf generate -> src/generated/{client,server}/ -> handlers wire up
```

- GET fields need `(sebuf.http.query)` annotation
- `repeated string` fields need `parseStringArray()` in handler
- `int64` maps to `string` in TypeScript
- CI checks proto freshness via `.github/workflows/proto-check.yml`

## Variant System

The app ships multiple variants with different panel/layer configurations:

- `full` (default): All features
- `tech`: Technology-focused subset
- `finance`: Financial markets focus
- `commodity`: Commodity markets focus
- `happy`: Positive news only
- `energy`: Energy security, chokepoints, oil/gas, and disruption timelines

Variant is set via `VITE_VARIANT` env var. Config lives in `src/config/variants/`.

## Key Patterns

### Adding a New API Endpoint

1. Define proto message in `proto/worldmonitor/<domain>/`
2. Add RPC with `(sebuf.http.config)` annotation
3. Run `make generate`
4. Create handler in `server/worldmonitor/<domain>/`
5. Wire handler in domain's `handler.ts`
6. Use `cachedFetchJson()` for caching, include request params in cache key

### Adding a New Panel

1. Create `src/components/MyPanel.ts` extending `Panel`
2. Register in `src/config/panels.ts`
3. Add to variant configs in `src/config/variants/`
4. Wire data loading in `src/app/data-loader.ts`

### Circuit Breakers

- `src/utils/circuit-breaker.ts` for client-side
- Used in data loaders to prevent cascade failures
- Separate breaker per data domain

### Caching

- Redis (Upstash) via `server/_shared/redis.ts`
- `cachedFetchJson()` coalesces concurrent cache misses
- Cache tiers: fast (5m), medium (10m), slow (30m), static (2h), daily (24h)
- Cache key MUST include request-varying params

## Testing

- **Unit/Integration**: `tests/*.test.{mjs,mts}` using `node:test` runner
- **Sidecar tests**: `api/*.test.mjs`, `src-tauri/sidecar/*.test.mjs`
- **E2E**: `e2e/*.spec.ts` using Playwright
- **Visual regression**: Golden screenshot comparison per variant

## CI Checks (GitHub Actions)

Twenty-one workflows live in `.github/workflows/`. The agent-relevant ones for merge readiness:

| Workflow | Trigger | What it checks |
|---|---|---|
| `typecheck.yml` | PR + push to `main` | `tsc --noEmit` (src) and `typecheck:api` |
| `test.yml` | PR + push to `main` | `npm run test:data` + sidecar/handler tests |
| `lint-code.yml` | PR + push | biome lints (`npm run lint`) |
| `lint.yml` | PR (markdown changes) | markdownlint-cli2 |
| `proto-check.yml` | PR (proto changes) | Generated code freshness |
| `security-audit.yml` | PR + push + schedule | npm audit advisories |
| `deploy-gate.yml` | `workflow_run` after Test/Typecheck/Lint/Security | Required status gate; blocks merge unless the upstream workflows pass |
| `build-desktop.yml` | Manual | Tauri desktop build |
| `test-linux-app.yml` | Manual | Linux AppImage smoke test |

`deploy-gate.yml` is the merge gate — required statuses roll up to it, not to the individual jobs.

## Pre-Push Hook

Runs automatically before `git push`. Two tiers:

**Always (state-dependent, fast — run even on a cache hit):** local Vercel env-dump guard, PR-state check (no pushes to merged/closed PR branches), branch-contamination guard (>20 commits ahead), `scripts/` lockfile sync.

**Tree-dependent (skipped entirely on a green-tree cache hit):** Unicode safety and version sync (always run for uncached trees), plus the diff-scoped checks: TypeScript (frontend tsc on `src/`-surface changes; `typecheck:api` on `api/|server/|scripts/|src/generated/`; Convex tsc on `convex/`), CJS syntax, boundary/safe-html/Sentry-coverage/rate-limit/premium-fetch lints (each also fires when its own guardrail script changes), edge esbuild check (`api/|server/|src/generated/` — edge entries bundle-import server code), markdown/MDX lint, proto + pro-test bundle freshness, change-scoped tests. `package.json`/`tsconfig` changes — or an unresolvable `origin/main` diff — force everything (an unresolvable diff also bypasses the green-tree cache: a blind run trusts nothing, including prior attestations).

**Green-tree cache:** a tree that passed the full gate is recorded (`$GIT_DIR/wm-prepush-green`); re-pushing the identical tree (remote failure, message-only amend) skips all tree-dependent checks — same tree, same result. Delete that file to force a full re-run.

Heavy checks (`test:data`, typechecks, edge-bundle) must run **sequentially** in worktrees — parallel runs OOM (exit 137).

## Shipping Velocity (Agent Workflow)

- **Before starting work on an issue:** check for parallel/duplicate work first — `gh pr list --search "<issue#>"` AND `git worktree list` (background codex/claude sessions ship PRs under the same account).
- **Merge authority is explicit and non-delegable:** never merge a PR, enable auto-merge, queue a merge, or run any equivalent GitHub merge action unless the user has explicitly requested that specific action in the current conversation. A request to implement, ship, push, create a PR, or monitor CI does **not** authorize merging. Wait for clear approval and report the ready state instead.
- **After pushing a PR:** do not sleep-poll CI. Start `gh pr checks <n> --watch` as a background task, or report the current check state; never turn on auto-merge without the explicit approval above.
- **docs/plans/ is gitignored** — plan documents are local working state and do not travel between worktrees or ship in PRs.
- **PR-review verification:** never assert a finding is fixed/stale from memory — re-fetch the PR head SHA and diff the cited lines first.

## Roadmap: Personalized Self-Hosted Build

Product direction (reprioritized 2026-07-21): keep worldmonitor theater-agnostic per user direction ("remove the focus on Iran, leave it as generic"). Build on existing infrastructure (CII, `src/services/correlation-engine/`, Alert Rule country-scope notifications, the Telegram-channel curated-source pattern, the OpenRouter-wired LLM chain) rather than standing up parallel systems. Goal: **more signal, less noise — personalized AI briefings, geopolitical & equity researcher for the operator running this fork.**

**Multiple agents may work this list concurrently.** Before starting an item: check `git log`, open PRs (`gh pr list`), and other worktrees (`git worktree list`) per Shipping Velocity above. Update the status marker when you start/finish an item so concurrent agents don't collide.

**Every item ships as its own PR.** One roadmap bullet = one branch = one PR (see Shipping Velocity above for the push/PR workflow and merge-authority rule — opening a PR is fine on request, merging still needs explicit approval in that conversation). Don't bundle multiple bullets into one PR; it makes concurrent-agent collisions and review harder to reason about.

**Always design for the best UX, not just the shortest technical path.** For every item on this list: think about the operator-facing experience (loading/empty/error states, how a feature is discovered, what happens when a dependency is missing or misconfigured, copy that explains what's happening) before shipping the backend plumbing alone. A correct API with no thought given to how a human encounters it is an unfinished item, not a done one.

### Tier 0 — Self-host personalization (do first, unblocks everything)

- [x] Iran domain reactivated (PR #1 merged): country-attributed events publish `conflict_escalation` via `wm:events:queue` so Alert Rules fire. **To go live**: set `IRAN_EVENTS_ENABLED=true` + `VITE_ENABLE_IRAN_ATTACKS=true` in your deployment env.
- [x] **Self-host entitlement bypass** — `WM_SELF_HOST=1` (server) + `VITE_SELF_HOST=1` (build arg → client) short-circuits every Pro/enterprise gate. Patch points: `server/_shared/self-host.ts` (central flag), `entitlement-check.ts:checkEntitlementDetailed`, `premium-check.ts:resolvePremiumCallerIdentity`, `direct-llm-quota.ts:reserveDirectLlmQuota`, `gateway.ts` direct-LLM block, `src/services/widget-store.ts:isProUser`, `src/services/entitlements.ts:{isEntitled,hasFeature,hasTier}`. Hosted deploys unaffected (flag defaults falsy).
- [x] **Local settings persistence (no forced sign-in)** — `src/services/local-secret-store.ts` provides an obfuscated localStorage vault for self-host web. `runtime-config.ts:setSecretValue()` now writes to it when `isSelfHost && !isDesktopRuntime()`. The API Keys tab in Settings (`UnifiedSettings.ts:renderSelfHostApiKeys`) shows per-feature key inputs grouped by category with "Get key" links, save button, and live status — no "Sign in" wall. The `RuntimeConfigPanel` dashboard panel is loaded for self-host and its inputs are enabled. Keys persist across sessions. Desktop OS-keyring path unchanged.
- [x] **Genericize LiveUAMap parser** — shared parsing now lives in `scripts/lib/liveuamap-parser.mjs`; `loadRegionConfig(countryCode)` loads validated location/default attribution from `data/liveuamap-regions/<country-code>.json`. Iran's regional spillover dictionary moved to `ir.json`, and `seed-iran-events.mjs` selects it explicitly. New theater location support is JSON-only.
- [x] **Telegram channel list bootstrap** — added @SEPAHCYBERY + @IT_Fouri (Persian cyber/tech channels) to `data/telegram-channels.json`. Created `data/telegram-channels.local.json` override template (tracked, edit for personal channels). Relay’s `loadTelegramChannels()` now merges base + local files; a docker-compose volume mount lets you edit local channels without rebuilding. Note field changed from "Not user-configurable" to "Base curated list." To go live: run `scripts/telegram/session-auth.mjs` to mint `TELEGRAM_SESSION`, set `TELEGRAM_API_ID` + `TELEGRAM_API_HASH` + `TELEGRAM_SESSION`, and set `TELEGRAM_CHANNEL_SET=full` on the relay. Follow-up: Settings UI for channel management, YouTube ingestion (@judgingfreedom @Tahlilgarsiasi).

### Tier 1 — Persian sources + AI briefings (high signal, low cost)

- [ ] **Native Persian RSS feeds** — add Mehr (`https://www.mehrnews.com/rss`), IRNA (`https://irna.ir/rss` — note `.ir` not `.org`), ISNA (`https://www.isna.ir/rss`). All three verified live on the Saba CMS, same platform as the existing `en.mehrnews.com` / `en.irna.ir` entries in `src/config/feeds.ts:310-314`. Today's Iran feeds all ingest English versions or Google News proxies — native Persian text is the open gap. Add `{ language: 'fa' }` metadata so they pair with the existing `fa.json` locale and RTL rendering.
- [ ] **GDELT Persian-language filter** — wrap `https://api.gdeltproject.org/api/v2/doc/doc` with `sourcelang:persian` + `sourcecountry:iran` as `api/gdelt-fa.js`. Verified free, no API key, supports JSON / RSS output. Got 429 in test → cache 5–10 min via `cachedFetchJson()` and throttle.
- [ ] **Confirm OpenRouter wiring** — already the default primary provider (`server/_shared/llm.ts:103`, default model `deepseek/deepseek-v4-flash`). Set `OPENROUTER_API_KEY` in `.env`; document overrides `LLM_REASONING_PROVIDER=openrouter` + `LLM_REASONING_MODEL=qwen/qwen-3-235b-instruct` (better Persian than deepseek) in `.env.example`. Streaming + `response_format:json_schema` structured outputs both verified supported on OpenRouter.
- [ ] **Local AI briefings cadence** — current `scripts/seed-digest-notifications.mjs`, `scripts/regional-snapshot/{narrative,weekly-brief}.mjs`, `scripts/seed-forecasts.mjs:market_implications` are Railway-cron-only. Bring them into docker-compose as scheduled one-shot containers, or trigger on demand via `docker compose exec`. Output briefs to Redis then `docker compose logs worldmonitor` for the dashboard to read.

### Tier 2 — Personalized equity / geopolitical researcher agent

- [ ] **Self-host chat-analyst persistence** — `chat-analyst` panel calls `api/chat-analyst.ts`; brief / Q&A history currently keyed by Clerk user id (`brief:{clerkUserId}:{date}` — see the comment in `src/app/panel-layout.ts` above `WEB_CLERK_PRO_ONLY_PANELS`, line drifts so don't pin it). For self-host, fall back to a local user-id (`wm-self` or `LOCAL_API_TOKEN`) when Clerk JWT absent.
- [ ] **Equity research skill** — extend chat-analyst with "researcher" mode using OpenRouter structured outputs (`response_format: json_schema`, verified). Multi-step synthesis: Finnhub fundamentals + Yahoo price + GDELT news-with-tone + ACLED actor events → structured `{thesis, risk, sources[]}` output. Persist Q&A history locally (no Convex) — `convex/apiKeys.ts` etc. need local-store fallbacks.
- [ ] **Persian-aware daily brief** — the regional-snapshot `narrative.mjs:426-481` already calls `callLlm`. Suffix the prompt with the operator's `followedCountries` (today `convex/followedCountries.ts` only — add a local JSON equivalent under `data/local-user-prefs.json` loaded when Clerk absents). Mix Persian + English primary sources, render the brief in either language based on `wm-locale-explicit`.

### Tier 3 — Pro-feature self-implementation (gated by Tier 0 entitlement bypass)

Server-side entitlement map at `server/_shared/entitlement-check.ts:ENDPOINT_ENTITLEMENTS` (lines `:76-97`). After the bypass lands, each becomes usable; verify handler still routes through OpenRouter (`server/worldmonitor/<domain>/v1/*.ts`):

- [ ] Forecast simulation (`/api/forecast/v1/trigger-simulation`)
- [ ] AI stock analysis + backtest (`/api/market/v1/{analyze-stock,backtest-stock,get-stock-analysis-history,list-stored-stock-backtests}`)
- [ ] Situational deduction + event classification (`/api/intelligence/v1/{deduct-situation,classify-event}`) — **verified these are gated differently**: `classify-event` is in `ENDPOINT_ENTITLEMENTS` (the Tier 0 bypass target), but `deduct-situation` is NOT — it's absent from that map and instead capped by a separate daily-quota system (`server/_shared/direct-llm-quota.ts:DIRECT_LLM_DAILY_QUOTA_LIMIT`, currently 50/day via `PRO_DAILY_QUOTA_TTL_SECONDS`). The Tier 0 entitlement bypass alone won't unlock unlimited `deduct-situation` — that quota also needs raising/removing for self-host.
- [ ] Supply-chain routing (8 `/api/supply-chain/v1/*` paths)
- [ ] Trade flows + tariff trends (`/api/trade/v1/*`)
- [ ] Sanctions pressure + global tenders (`/api/sanctions/v1/list-sanctions-pressure`, `/api/economic/v1/list-global-tenders`)
- [ ] Scenario engine (`/api/scenario/v1/{run-scenario,get-scenario-status}`)
- [ ] Regional Intelligence Board narratives (cron scripts in `scripts/regional-snapshot/`)
- [ ] MCP self-host (`mcpAccess===true` on `PremiumCallerIdentity` at `server/_shared/premium-check.ts:62-64`)

### Generic / backlog (reprioritized out of Iran-only)

- [ ] X/Twitter OSINT ingestion (`data/x-accounts.json` mirroring telegram-channels.json) — biggest repo capability gap, no X ingestion today.
- [ ] Ukraine front-line layer via deepstatemap.live public geojson — generic region template (use the LiveUAMap abstraction from Tier 0).
- [ ] Taiwan Strait PLA ADIZ-incursion counter (Taiwan MND publishes daily reports).
- [ ] Cross-theater "Escalation Convergence" view aggregating `correlation-engine` convergence cards across all active theaters.
- [ ] Event-type alert scoping (beyond existing country scope).
- [ ] Regional proxy-network actor map using ACLED actor-level attribution (generic — any axis / coalition).
- [ ] Connectivity kill-switch detection (IODA / Cloudflare Radar outage APIs) feeding CII's Information component.
- [ ] Black-market FX tracker (Rial or otherwise) as regime-stress leading indicator — region-parameterized.
- [ ] **YouTube geopolitical ingestion** — ingest captions/transcripts from YouTube channels with geopolitical analysis and interpretations (e.g., @judgingfreedom, @Tahlilgarsiasi). The repo already has `youtubei.js` as a dependency and `api/youtube/embed.ts`. Pattern: follow the Telegram relay pipeline — curated `data/youtube-channels.json` (handle, label, topic, tier, region, maxVideos) → relay poller → Redis → front-end panel. Needs a new seed/poller script in `scripts/` and relay cron.
- [ ] **Telegram channel UI management** — add/remove channels from the Settings modal instead of editing `data/telegram-channels.local.json` by hand. Writes to Redis or a relay HTTP endpoint; the relay reads the updated channel list at the next poll cycle.

### Out of scope / deprioritized

- **Maritime AIS**: aisstream.io OAuth currently broken on their backend (`dial tcp: lookup github.com ... write: operation not permitted` — their DNS sandbox issue). AISHub requires operating a physical receiver (data-exchange co-op); MarineTraffic now Kpler-owned enterprise-sales-only; no verified free HTTP AIS endpoint exists; SDR requires coastal hardware. Recommendation: leave `docker compose stop ais-relay`; revisit when aisstream.io recovers. Not viable to self-host.
- **Dedicated `iran.worldmonitor.app` variant**: per operator direction, keep theater-generic. Use the existing `full` variant with operator-followed countries.
- **Clerk / Dodo Payments / Convex stack for self-hosted deploys**: replaced by Tier 0 entitlement bypass + local-store. Do not stand up paid SaaS dependencies for personal use.

## Deployment

- **Web**: Vercel (auto-deploy on push to main)
- **Relay/Seeds**: Railway (Docker, cron services)
- **Desktop**: Tauri builds via GitHub Actions
- **Docs**: Mintlify (proxied through Vercel at `/docs`)

## Critical Conventions

- `fetch.bind(globalThis)` is BANNED. Use `(...args) => globalThis.fetch(...args)` instead
- Edge Functions cannot use `node:http`, `node:https`, `node:zlib`
- Always include `User-Agent` header in server-side fetch calls
- Yahoo Finance requests must be staggered (150ms delays)
- New data sources MUST have bootstrap hydration wired in `api/bootstrap.js`
- Redis seed scripts MUST write `seed-meta:<key>` for health monitoring

## Testing & Refactoring Conventions (learned from PR #5 review)

- **Don't hand-copy logic into tests.** If a function lives in a side-effectful monolith (e.g. `scripts/ais-relay.cjs`, 11k+ lines, no `module.exports`, starts a server on `require()`), extract the pure logic into `scripts/lib/<name>.cjs` following the existing pattern (`usni-fleet-parser.cjs`, `liveuamap-parser.mjs`, `telegram-channel-merge.cjs`). Then test the *imported* module — a duplicated copy drifts and gives false-green tests.
- **Preserve error-reporting state on refactor.** When refactoring a `load*()` function, keep any `lastError` / state-mutation it previously did for the `/status` or health endpoint. My initial merge refactor silently dropped `telegramState.lastError` — a corrupted base file would degrade to zero channels with no diagnostic. The error must surface (base file = required, ENOENT = error; local override = optional, ENOENT = silent; a present-but-broken file = error either way).
- **Use `e.code === 'ENOENT'`, not `e.message?.includes('no such file')`.** Node sets a structured `code` on filesystem errors; string-matching the message is locale-fragile and broke in some environments.
- **New `scripts/lib/*.cjs` files need a `COPY` line in `Dockerfile.relay`.** The file isn't auto-included by the `COPY scripts/ais-relay.cjs` line — it's an explicit per-file COPY list, guarded by `tests/dockerfile-relay-imports.test.mjs` (transitive-closure check). Run that test after adding any new `scripts/lib/` import.

## External References

- [Architecture (system reference)](ARCHITECTURE.md)
- [Design Philosophy (why decisions were made)](docs/architecture.mdx)
- [Contributing guide](CONTRIBUTING.md)
- [Data sources catalog](docs/data-sources.mdx)
- [Health endpoints](docs/health-endpoints.mdx)
- [Adding endpoints guide](docs/adding-endpoints.mdx)
- [API reference (OpenAPI)](docs/api/)
