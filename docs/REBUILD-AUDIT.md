# Agent Forge — Product Rebuild Audit (Phase 1)

Branch: `forge-product-rebuild` (isolated worktree). Base commit: `f51801c`.
Reference material read in full: this repo, `mcheemaa/saaya-feedback`, `mcheemaa/rendi`.

---

## 1. What Agent Forge currently does

Agent Forge is a **TypeScript CLI + Slack bot** (no web app). Two capabilities:

- **Forge** compiles a plain-English description into a runnable, self-tested Claude agent: it designs a system prompt, a fixed set of safe tools, and its own acceptance tests, then runs a **build → run → judge → refine** loop until the tests pass, emitting a *receipt* proving what the agent does.
- **Minions** are autonomous workers Forge makes. Each picks up one GitHub/Linear ticket, fixes it on a **sandboxed clone**, runs the test suite, and opens a PR **only when a previously-failing test goes green with no regressions** — otherwise it **declines**. A minion can read tests but **cannot write them**, so it cannot game the gate it is judged against.

Engine lives in `src/` (`builder, judge, runtime, refine, repair, spec, memory, trace, model, cli`, `src/minion/*`, `src/linear/*`, `src/slack/bot.ts`, `src/eval/trajectory.ts`). Front end is a single static `web/index.html` replay console. **No HTTP server, routes, auth, database, or streaming exist today.**

### Real data model already on disk (what the web product will render)
- **Receipt** `minion-receipts/*.json`: `ticketId, title, model, status(shipped|declined), reason, branch, steps, toolCalls, baselineTests{passed,total}, finalTests{ok,passed,failed,total}, patch, usage{inputTokens,outputTokens,totalTokens}, costUsd, durationMs, confidence{score,level}, risk{level,score,factors[]}, requiresReview`.
- **Profile** `.minion-profiles/*.json`: `repo, testCommand, files[], hotFiles[]`.
- **Corpus** `minion-corpus.json`: `summary{total,accepted,rejected,pending,declined}`, `cases[]{ticketId,minionStatus,humanOutcome,label,note}`.
- **Eval report** `minion-evals/report.json`: `model, total, correct, accuracy, unsafeShips, shipRecall{correct,total}, declinedCorrectly{correct,total}, cases[]{id,title,expect,decision,correct,unsafe,reason}`.
- **Run workspaces** `.minion-runs/E-*`: sandboxed git repos with `tickets.json`, `evalset.json`, `src/`, `test/`.
- **Forge receipts** `examples/*.receipt.json`: build/repair rounds per built agent.

## 2. What makes it distinct
The **verification gate**: work is accepted only when a real, previously-failing test passes with no regressions, and the worker physically cannot edit the test. On the hand-labeled eval: **0 unsafe ships, ship-recall 4/4, declined-correctly 3/3**. It ships good fixes and refuses bad ones, with a receipt for each. This is the whole thesis and must be the spine of every surface.

## 3. What makes it feel incomplete / unclear today
- There is no product surface: a reviewer sees a README + a static replay, not a usable product.
- "Forge" and "Minions" are described, not *operable*. You cannot create a minion, watch a run, or approve an action.
- The gate — the best part — is buried in prose and a screenshot instead of being a live, inspectable object.
- No landing page, no safe demo, no IA separating public vs app.

## 4. Five highest-impact product gaps
1. **No creation/command workbench (Forge)** — no way to describe a job, review a proposed minion, and put it to work.
2. **No minion identity/control surface** — minions are receipts, not inspectable, controllable workers (status, tools, permissions, runs, pause/disable).
3. **No durable Run view** — the run lifecycle (queued→planning→running→waiting-approval→…→completed/declined) and its timeline/artifacts are not visible.
4. **No approval model in the product** — the gate exists in the engine but there is no UI that distinguishes planned / requested / approved / executed / failed, server-enforced.
5. **No safe demo** — nothing lets a reviewer understand the product without credentials and private data.

## 5. Five highest-impact presentation gaps
1. No landing page that answers "what is this, why is it more than a chatbot" in seconds.
2. No original brand (Forge mark, Minion mark, tokens, light/dark, favicon, motion).
3. The eval proof (0 unsafe ships) is not shown as a first-class, visual object.
4. Architecture is a prose/mermaid placeholder, not a hand-crafted light/dark SVG.
5. README lacks the 30-second scan layer, real screenshots, metadata, LICENSE.

## 6. Reviewer findings that apply (translated from Saaya to Agent Forge)
| Saaya finding | Principle | Agent Forge application |
| --- | --- | --- |
| F1/F2 checkpoint leak → fabricated success | **Never show success the backend has not confirmed; enforce owner decisions in code, not model compliance** | The UI marks a run **shipped** only from `finalTests.ok === true`; a **declined** run is shown honestly with its reason. The gate is code-enforced (test must go green); never render a green state from a model claim. |
| F2 honesty laws never reach job path | One constitution across surfaces | Ship/decline copy always states *why*, from the receipt `reason`. |
| F3 done-check rejects directories | Verify postconditions correctly | Run states derive from real receipt fields, not guesses. |
| F4 gzip buffers the live stream | **Live surfaces must actually stream** | Stream Forge/run events with `Cache-Control: no-transform`, `X-Accel-Buffering: no`; tool cards show real durations from `durationMs`. |
| F5 heartbeat crash-loops on fresh clone | **Seed on boot; design empty states; fresh-clone CI** | Demo/app boot with seeded fictional fixtures; every list has an empty state. |
| F6 transient failure wipes sidebar | Keep last-known on error; refresh on reconnect | Sidebar/roster retain last-known data on fetch failure. |
| F7 workbench is a dead end on failure | Retry/cancel where you are looking | Run workbench header carries retry/cancel, not only the detail page. |
| F8 uncontrolled Collapsible warning | **Zero console errors** | Controlled disclosure components; console asserted clean in tests. |
| F10/F13 model misdescribes the gate; leaky offline copy | Accurate trust copy; honest offline state | Copy states exactly what pauses for approval and what the system cannot access; offline state is designed. |
| F16 empty metadata, license contradiction, mermaid | **Repo public face** | Real description+topics, MIT LICENSE, social card, 30-sec scan block, hand-crafted light/dark architecture SVG (Rendi technique), `brand/` + `BRAND.md`. |
| Hygiene rules | **No personal data in public fixtures/screenshots** | One fictional dataset (Acme/Northwind-style) across landing, demo, tests. |

## 7. Findings that do NOT apply and why
- F1/F3/F9 LangGraph/deepagents checkpoint internals, F11 `uv run`, F14 `/health`, F17 `CLAUDE_API_KEY` naming — **Saaya-specific stack** (Python/FastAPI/LangGraph). Agent Forge is TS/Node; we adopt the *principle* (fresh execution, golden run command, fail-fast on missing env) not the code.

## 8. Target information architecture
Public: `/` (landing), `/demo` (seeded, safe), `/about` (thesis + architecture + trust), `/docs` (links). App: `/forge` (workbench), `/minions`, `/minions/[id]`, `/runs`, `/runs/[id]`, `/activity`, `/settings`.
Public nav: Product · Demo · Minions · How it works · About · GitHub · Open Forge. App nav: Forge · Minions · Runs · Activity · Settings.

## 9. Intended user journey
Enter Forge → describe a job → Forge proposes a Minion (purpose, tools, permissions, instructions) → review → create/approve → Minion appears in the roster → it works through a durable Run (plan, tool activity, an approval pause, an honest failure + recovery, a verified artifact) → return to inspect, retry, pause, edit, or reuse.

## 10. Implementation order
1. Brand system + design tokens (Forge mark, Minion mark, tokens.css, BRAND.md, favicon) — **foundation**.
2. Next.js app scaffold reusing Rendi's shadcn `ui/`, shell, chat, ai-elements; central fictional fixtures + a typed data layer over the real receipt/eval/corpus shapes.
3. Landing page (hero → product model diagram → creation proof → minions proof → run/gate proof → control/trust → use cases → architecture → CTA).
4. `/demo` deterministic guided run (propose → review → create → run → tool activity → approval → honest failure → recovery → artifact → roster).
5. `/forge` workbench (sidebar, transcript, composer, workbench panel).
6. `/minions` + `/minions/[id]`; `/runs` + `/runs/[id]`.
7. `/about`, docs, README, architecture SVG, LICENSE, metadata, social card.
8. Test/a11y/responsive sweep with Playwright; state coverage; CI.

---

## Rendi reuse map (authorized)
Stack to mirror: **Next.js 16 (app router), React 19, Tailwind v4, shadcn (base-nova), lucide, next-themes, motion, sonner, cmdk, shiki, AI SDK**. Reuse `components/ui/*` (badge, button, card, dialog, sheet, sidebar, tabs, tooltip, command, empty, progress, skeleton, separator, collapsible, table…), `components/shell/*` (app-shell, app-sidebar, app-topbar, command-palette, theme-toggle), `components/chat/*` (transcript, composer, conversation-view, cards), `components/ai-elements/*` (message, tool, code-block, conversation, loader, reasoning). Brand technique from `brand/` (tokens.css, self-drawing marks, picture-element light/dark, BRAND.md). Adapt tokens away from Rendi's amber "Ember" to an original Forge identity so the result is not a recognizable Rendi clone.
