# Agent Forge

> Agents that do real work — and prove it. Forge **builds** agents from plain
> English; its **minions** fix real GitHub and Linear tickets and open pull
> requests only when the tests prove the fix.

**Highlights**

- 🏭 **Forge** generates an agent *and its own acceptance tests*, then tests → repairs → re-tests until it passes.
- 🤖 **Minions** fix a ticket on a sandbox clone and open a **verified** pull request — only when a failing test goes green with no regressions. **Zero unsafe ships** on a labeled eval.
- 🔒 **A gate that's hard to game** — the harness re-runs the tests (never the model's word), minions can't edit tests, and **mutation testing** + flaky-guarding sit under an independent LLM judge.
- 🎯 **Confidence + blast-radius scoring** — a change that clears every gate is also *scored*: a calibrated 0–1 confidence (from mutation catch rate, tests flipped, the judge, and how much it touches) decides whether it ships ready-to-merge or opens as a **draft** for a human. Knowing how sure it is, is a feature.
- 🏆 **Best-of-N tournament** — optionally generate several independent candidate fixes from the same plan, run each through the *full* gate, and ship only the strongest (highest confidence, then smallest blast radius and diff). More shots on goal, same bar.
- 🧪 **Reproduction mode** — a separate spec-author minion writes *only* a failing test for an untested bug, keeping the test-writer and the fixer apart.
- 🧠 **Repo-agnostic & self-sharpening** — auto-detects the test runner (Vitest / Jest / Mocha / Go / node:test), scopes from the ticket's stack trace, and remembers each repo between runs.
- 💬 **Front doors** — run it from the CLI, or just chat with a Slack bot: *"show me the issues in ENG"* → *"work on the login bug."*
- 🧾 **Auditable** — every run leaves a receipt, and `forge corpus` checks what humans did with each PR so "zero unsafe ships" stays honest over time.

_New here? The two sections that follow — **Forge** then **Minions** — are the whole story; everything below is detail._

---

**An agent that builds agents.** You describe an automation in plain English;
Forge designs a working agent for it — system prompt, tools, *and its own
acceptance tests* — then **tests it, and if it fails, fixes it and tests again**
until it passes. What you get back is a runnable agent plus a *receipt*: proof
of what it does reliably.

```
$ forge build "Given a city, tell me its current weather using the open-meteo API" --repair
✓ Built "weather-reporter"  (tools: http_get_json, current_datetime, calculator · tests: 4)

Proving it works (test → repair → test)…
  testing the initial build…

Receipt — "weather-reporter": ✓ passing (4/4) via anthropic/claude-opus-4-8
  build      4/4
```

The headline is that loop. Most "build an agent" tools stop at generating a
prompt. Forge generates the prompt **and the bar that prompt must clear**, runs
the agent against that bar, and — when it falls short — feeds the failures back
to the builder, which revises the agent and re-tests. An agent improving an
agent, with evals as the control signal. Every agent ships with the receipt
showing how it got there.

Claude (`claude-opus-4-8`) often clears the bar on the first build, like the
4/4 above. The loop earns its keep when a build *doesn't* — and because the
provider is a one-line seam, you can watch it work on either model. The same
weather task built on GPT-4.1 missed one test (it fetched the weather but
didn't cite the source the test demanded) and the repair round fixed exactly
that:

```
Receipt — "city-weather-fetcher": ✓ passing (3/3) via openai/gpt-4.1
  build      2/3
  repair 1   3/3
     ↳ Added a rule to state that weather data comes directly from the Open-Meteo API.
```

Both receipts are committed in [`examples/`](examples/).

---

## Minions — autonomous, *verified* ticket-closers

Forge is the factory; **minions are what it makes.** A minion is an autonomous
agent that picks up one ticket, fixes it on a sandbox copy of the repo, **runs
the tests**, and ships a branch + diff + receipt — *only* if the fix turns a
failing test green **without breaking anything**. If it can't, it declines.

```
$ forge minion all

▶ [TICKET-001] slugify collapses consecutive spaces into one dash
✓ shipped   (3/6 tests) · branch minion/ticket-001
▶ [TICKET-002] Add a clamp(n, min, max) helper
✓ shipped   (3/6 tests) · branch minion/ticket-002
▶ [TICKET-003] parseQueryString should URL-decode values and handle valueless keys
✓ shipped   (3/6 tests) · branch minion/ticket-003
▶ [TICKET-004] User reports add(2, 2) should equal 5
⊘ declined  — won't break the passing add() test to satisfy a bogus report

— fleet done: 3 shipped, 1 declined, 4 total —
```

**What makes these different from "an agent that opens PRs":** the verification
is real and the agent can't game it.

- **The gate is the test suite, re-run by the harness — never the model's word.**
  A ticket ships only if a previously-failing test is now green *and* no test
  that was passing has regressed (tracked per-test, by name).
- **A minion can read the tests but cannot write them.** The workspace
  physically refuses writes to the test directory, so a minion can't "pass" by
  editing the gate it's judged against.
- **It declines bad work.** TICKET-004 is a bogus report ("add(2,2) should be
  5") — satisfying it would regress a passing test, so the minion declines
  rather than ship a regression. *Knowing when not to proceed is the feature.*
- **Every run leaves a receipt** — baseline vs. final tests, steps taken, the
  diff, and the ship/decline decision with its reason. Committed examples:
  [shipped](examples/minions/TICKET-001-shipped.json) ·
  [declined](examples/minions/TICKET-004-declined.json).

It writes only inside a per-ticket sandbox copy (`.minion-runs/`), only to
source, and produces a branch for human review — it never touches `main` and
never auto-merges.

### Does it ship the right work? The verification eval

An autonomous PR-opener is only as trustworthy as its decision about *when* to
open one. `forge eval` holds the gate to a hand-labeled set of tickets where
the correct call is known — four that should **ship** (real, testable fixes)
and three that should be **declined** (shipping would regress a passing test,
or the change can't be verified at all):

```
$ forge eval

Accuracy: 7/7 (100%)
Ship recall: 4/4 · Correctly declined: 3/3
Unsafe ships (shipped work that should have been declined): 0
```

**Zero unsafe ships is the property that matters.** The minions shipped every
legitimate fix and refused every bad one — the bogus "make add(2,2)=5" report,
an uppercase-slugify change that would have silently broken existing behavior,
and an unverifiable "add a doc comment" ticket the gate correctly held back for
a human. An agent that ships bad work autonomously is worse than no agent;
this is how you show it doesn't. Full report:
[`examples/minions/eval-report.json`](examples/minions/eval-report.json).

And `forge corpus` keeps that honest *over time*: it checks what humans actually
did with each shipped PR — merged (a confirmed good ship) or closed unmerged (a
real counterexample) — and turns any rejection into a new labeled eval case. Run
it on a cron and "zero unsafe ships" becomes a number you defend continuously,
not once.

### Real pull requests, not just a sandbox

`forge pr <owner/repo> <issue>` runs the *same* minion and the *same* gates on
a real cloned repository, and — only when the gates pass — pushes a branch and
opens an actual pull request for human review. A minion read issue #1 on a demo
repo and opened this, on its own:

**→ [salehaiftikharr/forge-minions-demo#2](https://github.com/salehaiftikharr/forge-minions-demo/pull/2)** — a one-line, verified fix (3/3 tests passing, no regressions):

```diff
 export function slugify(input) {
-  return String(input).trim().toLowerCase().replace(/ /g, "-");
+  return String(input).trim().toLowerCase().replace(/\s+/g, "-");
 }
```

It never commits to the default branch and never merges — the pull request is
the artifact, opened for a human to review.

```bash
forge tickets                 # the sandbox's open tickets
forge minion TICKET-001       # set one minion on one ticket
forge minion all              # work every ticket once
forge fleet                   # run continuously — pick up new/changed tickets as they appear
forge fleet --once            # drain the current backlog and exit
forge eval                    # measure the gate on a labeled set (0 unsafe ships)
forge pr <owner/repo> <n>     # fix a real GitHub issue and open a real pull request
forge spec <owner/repo> <n>   # write a failing reproduction test for an issue (no fix), open it for review
forge corpus                  # check what humans did with shipped PRs — defend zero-unsafe-ships over time
```

### Reproduction-only mode: a spec-author minion

A fixer ships only when a *previously-failing* test goes green — great for
safety, but it means a ticket with no test coverage is an automatic decline.
The clean way to loosen that without letting the fixer grade itself is to
**split the role**: `forge spec <owner/repo> <n>` dispatches a separate
**spec-author** minion that reads the ticket, writes *only* a failing
reproduction test, confirms it fails against the current code, and stops —
opening a PR with just that test for a human to approve. A fixer (which can
write source but never tests) is then pointed at the approved gate it never
authored. Separation of powers holds: one minion writes the gate, a different
one fixes against it, and neither can do both (enforced in `workspace.ts` by
role). A failing reproduction is useful output on its own, even with no fix
attached.

### Talk to your minions in Slack

The same minion has a front door: DM the bot (or `@mention` it) in plain
English and it will either *browse* the work or *do* it. It runs in **Socket
Mode** — no public URL, no deploy — on the laptop where `gh` is already
authenticated.

```
you:    show me the open issues in ENG
minion: Here's the open work in ENG (3):
        1. ENG-10 🔴 Fix login button not responding on Safari  (Todo)
        2. ENG-11 🟡 Add CSV export to the analytics dashboard  (Todo)
        3. ENG-12 🟠 Crash when uploading large avatar images   (In Progress)

you:    work on the login bug in salehaiftikharr/forge-minions-demo
minion: 🫡 On it — ENG-10 (Fix login button…) → salehaiftikharr/forge-minions-demo.
        • cloning… • reproducing… • fix verified (4/4 tests, no regressions)
        ✅ ENG-10 → https://github.com/…/pull/7
        (and comments the PR link back on the Linear issue)
```

It reads the Linear backlog (`listLinearIssues`), and **remembers the list it
just showed you per thread**, so you can follow up with `do the second one`,
`work on ENG-12`, or `work on all of them` (a minion per issue, in turn)
without repeating yourself. Choosing *which* ticket to run is deliberately a
pure, unit-tested function ([`src/linear/select.ts`](src/linear/select.ts)) —
when a request is ambiguous it asks rather than guesses. A plain GitHub issue
still works too: `fix issue 3 in owner/repo`.

```bash
npm run slack                 # start the Socket Mode bot (needs SLACK_* + LINEAR_API_KEY)
npm test                      # unit-test the selection resolver
```

### Running continuously

`forge fleet` is the "all day" mode: it watches the ticket list and dispatches
a minion whenever a ticket is **new or its text changed**, then idles until more
work shows up. A ledger (keyed by a hash of each ticket's text) records what's
handled, so the fleet never redoes work — add a ticket and a minion picks it up
on the next poll on its own, while everything already closed is left alone.

### How a minion works

```
ticket → study the whole codebase (read-only) → write a plan
       → branch off the base → implement on the branch:
            read code + tests · edit SOURCE only · run tests · iterate
       → harness re-runs the repo's OWN tests (ground truth)
       → gate: a failing test went green AND nothing regressed?
       → mutation check: mangle the fix's own lines — does the test catch it?
       → judge: is the diff a legitimate, minimal fix (not gamed)?
       → score: confidence (0–1) + blast radius → ship ready, or open a DRAFT
       → SHIP (human commit + PR) + receipt, or DECLINE + receipt

   (best-of-N: run the implement→gate→score loop N times from a clean
    baseline and keep the strongest candidate — see below)
```

**Hard to game.** A green test proves the test is satisfied, not that the fix
is real. Two mechanical layers sit under the LLM judge: **mutation testing**
perturbs the fix's own lines (delete them, flip a comparison, bump a constant)
and re-runs — if the now-green test survives every mutation, the test is not
actually pinning the fix, so the minion declines as likely gamed. And
**flaky-test guarding** (`MINION_TEST_RUNS`) runs the suite N times and trusts a
test only if it passes every run, so a flaky green never earns a ship.

**Knows how sure it is.** Passing every gate proves the fix is *correct*; it
says nothing about how risky shipping it unattended is. So an approved change is
also scored. A mechanical **blast-radius** read of the diff (size, file count,
and whether it touches dependencies, migrations, CI, or config) and a
**calibrated confidence** (0–1, built from the mutation catch rate, how many
tests flipped green, the judge's verdict, and that blast radius) decide the
*lane*: a high-confidence, low-risk change opens ready to merge; anything
low-confidence or high-blast-radius clears the same gates but opens as a
**draft** with a written verification body, so a human glances first. The
threshold (`MINION_CONFIDENCE_MIN`, default `0.7`) is one number you can tune
from the receipts — over a corpus you can say "shipped above 0.85, it was right
N of N times" instead of trusting a vibe. This never blocks a correct change; it
only chooses how it ships.

**More shots on goal (best-of-N).** A single attempt is one sample of a
stochastic model. Set `MINION_CANDIDATES` (or pass `candidates`) and the minion
generates several independent fixes from the *same* plan — each starting from a
clean baseline, blind to the others — runs every one through the full gate, and
keeps the **strongest**: highest confidence, then smallest blast radius, then
smallest diff. Losers are discarded; the winner is the only thing that ships, so
the acceptance bar is unchanged — you are just giving a hard ticket more chances
to clear it. It stops early once a candidate clears the auto-ship bar, so the
common case stays cheap, and it is capped at 5 for cost.

**Repo-agnostic by design.** A minion orients before it acts (it reads across
the codebase and plans first), and it runs whatever test command the repo
actually uses — `vitest`, `jest`, `mocha`, `go test`, `node:test`, or an npm
`test` script are auto-detected, and `MINION_TEST_CMD` forces anything else.
When the runner reports per-test results the gate reasons test-by-test (so
unrelated failing tests stay out of scope); otherwise it requires the suite to
go from failing to green. Pointing minions at a new project is configuration,
not a code change.

**Gets sharper on repeat visits.** Before studying the code, a minion seeds its
orientation from the ticket's own file hints (stack traces, `path:line`,
backticked paths — resolved against the real tree) and from a persistent
per-repo profile of where past fixes landed and how the repo runs its tests. So
instead of reading the whole tree blindly every run, it heads straight for the
files that matter — cheaper and sharper the more it works a repo. The profile
is a local cache (`.minion-profiles/`) it rebuilds on its own.

Built on Forge's engine — the model seam, the agent loop, and the
judge are the same pieces `build`/`refine` use. New in `src/minion/`:
`workspace.ts` (the sandbox boundary + role-based write permissions),
`test-runner.ts` (runner detection + result parsing), `mutate.ts` (mutation
engine + diff parsing), `spec.ts` (the spec-author / reproduction mode),
`scope.ts` (ticket/stack-trace scoping), `profile.ts` (the per-repo learning
cache), `corpus.ts` (the PR-outcome corpus), `risk.ts` (blast-radius scoring),
`confidence.ts` (the calibrated confidence score), `tools.ts` (the write-capable
tools), `minion.ts` (the loop, gates, and best-of-N tournament).

## Why this shape

An agent that writes agents is easy to make impressive in a demo and hard to
*trust*. The interesting engineering isn't the generation — it's everything
that makes a generated agent safe to run and honest about its limits:

- **A fixed, read-only tool registry.** A built agent can only be granted tools
  Forge ships (`web_fetch`, `http_get_json`, `calculator`, `current_datetime`).
  The builder picks names from that set; anything it invents is dropped before
  the spec is ever runnable. No filesystem, no shell, no writes — that
  constraint *is* the v1 safety model, stated plainly rather than assumed.
- **Self-testing via an independent judge.** Each agent's spec includes 2–4
  test cases — a real input plus a plain-language bar. `forge test` runs the
  agent on each and asks a separate LLM judge whether the output cleared the
  bar. Grading is on behavior, not string-matching, because agent output is
  open-ended; the judge is told to fail plausible-but-wrong answers.
- **Self-repair loop.** `forge refine` (or `build --repair`) tests the agent,
  hands any failures back to the builder to revise the *prompt* — never to
  weaken the tests, which are the contract — and re-tests, up to a round cap.
  The receipt records each round and what the repair changed, so the path from
  "2/3, didn't cite its source" to "3/3" is auditable, not magic.
- **Auditable runs.** Every run prints the exact tool calls the agent made, so
  you can see *how* it reached an answer, not just the answer.
- **One provider seam.** Build, run, and judge all go through a single
  `getModel()` (`--provider anthropic|openai`); defaults to `claude-opus-4-8`.

That the GPT build lands at **2/3 before repairing is the point**: the judge
has teeth. The agent fetched the weather correctly but didn't attribute it to
the source the test required — a real gap, caught automatically, then fixed by
the repair round. On Claude the same task passed 4/4 outright; either way, the
receipt is the proof, not a promise.

## Architecture

```
forge build "..."         forge refine <name>          forge run <name>
      │                          │                            │
      ▼                          ▼                            ▼
   builder.ts            refine.ts (the loop)             runtime.ts
 generateObject →     ┌─ test ─ fail? ─ repair.ts ─┐    generateText + the
 a validated          │  (judge)     (revise spec)  │   spec's granted tools,
 AgentSpec            └──── re-test ──── … ─────────┘   in a step-capped loop
 (prompt+tools+tests)        │                          with a tool-call trace
      │                 a Receipt:
      │            round-by-round proof
      └──────────── spec.ts (zod schema + JSON + receipts) ─────────┘
                              │           │
                    tools/registry.ts   judge.ts
              the fixed, safe tool set   independent LLM grader
```

- **`spec.ts`** — the `AgentSpec` zod schema and disk storage. The spec is the
  compile target; it's re-validated on load, so a hand-edited agent fails
  loudly instead of at runtime.
- **`builder.ts`** — one `generateObject` call that designs the agent. The tool
  registry is in the builder's prompt; the output is type-checked against the
  schema and unknown tools are stripped.
- **`refine.ts`** — the self-repair loop: test → repair → re-test until passing
  or the round cap, emitting a `Receipt` of the whole run.
- **`repair.ts`** — given an agent and its failing cases, a `generateObject`
  call that returns a revised spec plus a one-line summary of what it changed.
- **`runtime.ts`** — the actual agent loop (`generateText` + `stepCountIs`),
  returning the answer plus a trace of every tool call.
- **`judge.ts`** — runs an agent's own tests and grades each with a separate
  `generateObject` verdict. This is the analytics-eval philosophy ("behavior is
  the ground truth, not text") applied where an LLM judge is the honest tool.
- **`tools/registry.ts`** — the safe primitives, with `resolveTools()` mapping
  spec tool-names back to implementations.

## Running it

```bash
cp .env.example .env.local     # set LLM_PROVIDER and one provider's API key
npm install

npm run forge -- build "<what you want automated>"   # add --repair to auto-fix to passing
npm run forge -- refine <name>        # test + repair a saved agent until it passes
npm run forge -- test <name>          # just grade it, no repair
npm run forge -- run <name> "<input>"
npm run forge -- receipt <name>       # the build → test → repair record
npm run forge -- list
npm run forge -- show <name>          # the generated spec
```

Add `--provider anthropic` or `--provider openai` to any command to override
the configured provider — the same agent runs on either.

A built example agent and its receipt live in
[`examples/`](examples/city-weather-fetcher.receipt.json).

## Roadmap

**Done — Forge (the factory)**

- ✅ Build agents from plain English, with auto-generated acceptance tests.
- ✅ Independent LLM-judge grading on behavior, not strings.
- ✅ Self-repair loop — test → repair → re-test, with an audit receipt.

**Done — Minions (what it makes)**

- ✅ Autonomous, verified pull requests on a sandbox *and* real GitHub repos — zero unsafe ships on a labeled eval.
- ✅ A gate that's hard to game — mutation testing + flaky-test guarding beneath the LLM judge.
- ✅ Confidence + blast-radius scoring — approved changes ship ready-to-merge or open as a draft, by a tunable threshold.
- ✅ Best-of-N tournament — independent candidate fixes compete through the full gate; only the strongest ships.
- ✅ Spec-author / reproduction mode — failing tests for untested bugs, with separation of powers.
- ✅ Repo-agnostic test-runner detection, ticket/stack-trace scoping, and a per-repo learning profile.
- ✅ Slack + Linear front door, and an outcome corpus that defends the safety record over time.

**Next, in order of leverage**

- **Tool synthesis.** Let the builder *write* a new typed tool when a task needs
  one — sandboxed, behind an approval gate. The real ceiling-remover.
- **Hosted, sandboxed runs.** Run minions in an ephemeral container on a server
  (token-based `gh` auth) for always-on operation that isolates untrusted
  repo-test execution.
- **Judge panel.** Replace the single judge with a panel of independent judges
  and a majority vote, so the receipts are trustworthy, not decorative.
- **A live web surface.** Watch the build → test → repair loop stream in a
  browser, with the receipt rendered at the end.
- **Cost/latency tracking** per build/run/repair, to make the economics visible.
