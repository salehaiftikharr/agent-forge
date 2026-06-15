# Agent Forge

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

Done:

- ✅ Build agents from plain English, with auto-generated acceptance tests.
- ✅ Independent LLM-judge grading on behavior, not strings.
- ✅ **Self-repair loop** — test → repair → re-test, with an audit receipt.

Next, in order of leverage:

- **Tool synthesis.** Today agents can only use the built-in tools. Let the
  builder *write* a new typed tool when the task needs one — sandboxed, and
  behind an approval gate before it ever runs. This is the real ceiling-remover.
- **Judge panel.** Replace the single judge with a panel of independent judges
  and a majority vote, the way a serious eval harness treats a finding it's
  unsure about — so the receipts are trustworthy, not decorative.
- **A live web surface.** Watch the build → test → repair loop stream in a
  browser, with the receipt rendered at the end, plus a public gallery of built
  agents.
- **Write tools behind a human-in-the-loop gate.** Everything is read-only by
  design today; side-effecting tools (send email, write file) require a
  confirmation step, not optional.
- **Cost/latency tracking** per build/run/repair, to make the economics of a
  generated agent visible.
