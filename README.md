# Agent Forge

**An agent that builds agents.** You describe an automation in plain English;
Forge designs a working agent for it — system prompt, tools, *and its own
acceptance tests* — saves it, and can run it or grade it on demand. It's a
small compiler from a sentence to a runnable, self-verifying agent.

```
$ forge build "Given a city, tell me its current weather using the open-meteo API"
✓ Built "city-weather-fetcher"
  tools: web_fetch, http_get_json
  tests: 3

$ forge test city-weather-fetcher
✅ Show me the weather in Springfield.    → asks which Springfield before answering
✅ Tell me the current weather in Atlantis. → refuses; not a real city
❌ What's the current weather in Paris?   → got the weather, didn't cite the source the test demanded
2/3 passed
```

The headline feature is the last step. Most "build an agent" tools stop at
generating a prompt. Forge generates the prompt **and the bar that prompt has
to clear**, then holds the agent to it — so every agent it produces comes with
evidence of what it does and doesn't do reliably.

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
- **Auditable runs.** Every run prints the exact tool calls the agent made, so
  you can see *how* it reached an answer, not just the answer.
- **One provider seam.** Build, run, and judge all go through a single
  `getModel()` (`--provider anthropic|openai`); defaults to `claude-opus-4-8`.

That the example above scores **2/3, not 3/3, is the point**: the judge has
teeth. The agent fetched Paris's weather correctly but didn't attribute it to
the source the test required — a real gap, surfaced automatically. The
ambiguity case ("which Springfield?") and the refusal case ("Atlantis isn't
real") both passed on their own merits.

## Architecture

```
forge build "..."           forge run <name>            forge test <name>
      │                           │                            │
      ▼                           ▼                            ▼
   builder.ts                 runtime.ts                   judge.ts
 generateObject →         generateText + the           runs each test case
 a validated AgentSpec    spec's granted tools,        through runtime.ts,
 (prompt+tools+tests)     in a step-capped loop        then an LLM judge
      │                           │                     grades pass/fail
      └──────────── spec.ts (zod schema + JSON storage) ─────────┘
                              │
                    tools/registry.ts
              the fixed, safe capability set
```

- **`spec.ts`** — the `AgentSpec` zod schema and disk storage. The spec is the
  compile target; it's re-validated on load, so a hand-edited agent fails
  loudly instead of at runtime.
- **`builder.ts`** — one `generateObject` call that designs the agent. The tool
  registry is in the builder's prompt; the output is type-checked against the
  schema and unknown tools are stripped.
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

npm run forge -- build "<what you want automated>"
npm run forge -- list
npm run forge -- test <name>
npm run forge -- run <name> "<input>"
npm run forge -- show <name>          # the generated spec
```

Add `--provider anthropic` or `--provider openai` to any command to override
the configured provider — the same agent runs on either.

A built example agent lives in [`examples/`](examples/city-weather-fetcher.json).

## Known limitations & next steps

Honest about what v1 doesn't do:

- **Fixed tool set.** Agents can only use the four built-in tools. The natural
  next step is letting the builder *synthesize* a new tool (a small typed
  function) when the task needs one it doesn't have — behind an approval gate.
- **The judge is a single model.** A stricter version would use a panel of
  independent judges and require a majority, the way a serious eval harness
  treats a finding it's unsure about.
- **No approval gate / write tools yet.** Everything is read-only by design.
  Adding side-effecting tools (send email, write file) is the point where a
  human-in-the-loop confirmation step becomes mandatory, not optional.
- **Single-turn agents.** Built agents answer one input at a time; conversational
  memory across turns is a later addition.
- **No cost/latency tracking.** Token usage per build/run/test would make the
  economics of a generated agent visible.
