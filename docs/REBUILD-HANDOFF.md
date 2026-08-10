# Agent Forge — Rebuild Handoff

Branch: `forge-product-rebuild` (isolated worktree; `main` untouched). All work
authored as Saleha Iftikhar. The existing TypeScript CLI + Slack engine is
preserved unchanged; the web product is built around it.

## 1. Executive summary

Agent Forge was a CLI + Slack tool with a static HTML replay. This rebuild adds
a coherent product: an original brand system, a narrative landing page, a
deterministic guided demo, and an application (Forge workbench, Minions roster
and detail, Runs with timelines and approvals) built on **one shared model**.
Real engine evaluation data and a single fictional dataset are rendered by the
same components and are always labelled so the two never blur. The full
Playwright + axe suite passes, the production build is clean, and the repo now
has an MIT license, community files, metadata, and a hand-crafted architecture
diagram.

## 2. Before → after

| | Before | After |
| --- | --- | --- |
| Product surface | Static `web/index.html` replay | Next.js app: landing, demo, Forge, Minions, Runs, About, Activity, Settings |
| Forge | CLI command | Interactive workbench (conversation + workbench panel) |
| Minions | JSON receipts | Operational entities: identity, status, tools, permissions, data access, runs |
| Runs | Receipt files | Durable-run view: gate summary, timeline, approvals, diff artifacts, retry/cancel |
| Brand | None | Forge + Minion marks, tokens, light/dark, favicon, animated mark |
| Repo face | No license/metadata | MIT, topics, community files, README scan block + architecture SVG |
| Verification | Unit tests | Unit tests + 34 Playwright e2e + axe a11y on 10 routes |

## 3. Reviewer-feedback traceability (Saaya → Agent Forge)

| Principle (from feedback) | Implementation | Evidence |
| --- | --- | --- |
| Never show success the backend has not confirmed | Runs render `completed` only from real gate results; demo approval reveals results only after the decision | `run-timeline`, `demo-player`; e2e "approve → …shipped" |
| Enforce owner decisions, don't trust the model | Approval blocks progression; copy states the engine enforces at execution time | e2e "approval gate blocks progression" |
| Honest failure / decline states | Timeline shows failure → retry → recovery; decline shown calmly in blue, never red | e2e; `/runs/r-recover`, `/runs/r-decline` |
| Live surfaces must actually stream | Demo/timeline reveal tool activity with real durations; no fabricated 0ms | timeline durations |
| Seed on boot / empty states | Roster/list empty states; settings states what is wired | `minion-roster`, `/settings` |
| Keep last-known on transient failure | Client filters are session-local; server data read at request time | n/a (no fetch-wipe pattern used) |
| Retry/cancel where you are looking | Run controls on the run surface (approve/reject, retry/cancel) | `run-controls`; e2e |
| Zero console errors | Asserted on landing | e2e "console health" |
| Accurate trust copy; honest offline | "From the engine" vs "Demo data" badges; settings limitations | `ui`, `/about`, `/settings` |
| Repo public face: license, metadata, mermaid → SVG | MIT LICENSE, description + 10 topics, hand-crafted light/dark architecture SVG | `LICENSE`, `brand/architecture*.svg`, gh metadata |
| No personal data on public surfaces | One fictional dataset; denylist asserted in tests | e2e "privacy" on 7 routes |
| WCAG AA | axe scan, contrast fixes | e2e a11y on 10 routes |

Not applied (Saaya-specific stack: LangGraph/deepagents checkpointer, `uv run`,
`/health`, `CLAUDE_API_KEY` naming). Underlying principles adopted; code not.

## 4. Information architecture

Public: `/`, `/demo`, `/about`. App: `/forge`, `/minions`, `/minions/[id]`,
`/runs`, `/runs/[id]`, `/activity`, `/settings`. Public nav: Product · Demo ·
Minions · How it works · About · GitHub · Open Forge. App nav: Forge · Minions ·
Runs · Activity · Settings.

## 5. Brand system

Original "Forge" identity: cool steel neutrals + one molten ember, light and
dark designed together (`brand/tokens.css`, mirrored in `web/app/globals.css`).
- **Forge mark**: a shaping die with a struck V-notch, a billet, and an ember in
  the notch (making / shaping / spark / precision). Static + self-forging
  animated (`forge-mark.svg`, `forge-mark-animated.svg`), plus favicon.
- **Minion mark**: the same die, smaller, with a status dot at the shoulder;
  one mark, every state (`minion-mark.svg`). Status never relies on color alone
  (dot + always-present text label).
- Avoids AI clichés (no gradients, robot heads, sparkles) and the copyrighted
  yellow character.

## 6. Shared model, data, reuse

- One model in `web/lib/types.ts`; two sources: `lib/engine-data.ts` (real,
  vendored to `web/engine-data/`) and `lib/fixtures.ts` (fictional Northwind).
- Shared components across marketing/demo/app: `marks`, `ui`, `minion-card`,
  `run-timeline`, `product-diagram`, `app-shell`, `demo-player`, `diff-view`.
- Rendi reuse: adopted its stack shape (Next.js App Router, Tailwind v4,
  shadcn-style primitives, next-themes, lucide) and its brand technique
  (self-drawing marks, tokens, picture-element light/dark, hand-crafted SVG
  diagram). The visual identity is original, not a Rendi clone.

## 7. Security / honest limitations

Enforced boundaries live in the engine (gate can't be edited by the minion,
write-class actions gated, sandboxed runs, secrets from env) — documented in
`SECURITY.md`. The web app in this build has **no authentication**, does **not
call a model directly**, and **does not persist** demo interactions; each is
stated in `/settings`, `/about`, and `web/README.md`, and demo controls are
labelled session-local. No fabricated auth/streaming/persistence.

## 8. Results

- **Production build:** passes, 12 routes, ~103 kB shared JS.
- **Automated tests:** `npx playwright test` → **34 passed** (journeys, demo gate
  + approve/reject, minions, runs, responsive overflow, mobile drawer, keyboard,
  privacy denylist, console health).
- **Accessibility:** axe (wcag2a/2aa/21a/21aa) on 10 routes → **0 serious/critical**.
- **Browser verification (Playwright MCP):** landing (light + dark), demo full
  golden path, minions roster, run detail, mobile 390px (no overflow), mobile
  nav drawer.

## 9. Known limitations / deferred (with reason)

- Authentication, real streaming, and web persistence are out of scope for this
  build and labelled honestly rather than faked.
- e2e runs locally against the production build; wiring it into the existing CI
  workflow is a follow-up.
- Automated viewport coverage focuses on 390px + 1280px; 768/360/reduced-motion
  were checked manually, not yet asserted for every route.
- Social preview image (1280×640) not yet generated.

## 10. Run commands

```
# Engine (repo root)
npm install && npm test

# Web product
cd web
npm install
npm run dev            # http://localhost:3001
npm run build          # production build
npx playwright install chromium   # first time only
npm run test:e2e       # 34 e2e + axe, against the production build
```

Reference: `docs/REBUILD-AUDIT.md` (Phase-1 audit), `web/README.md`,
`brand/BRAND.md`.
