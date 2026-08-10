# Agent Forge — web product

The product surface for Agent Forge: a landing page, a guided demo, and an
application (Forge workbench, Minions, Runs) built on the same engine that
powers the CLI and Slack bot.

## Run it

```
cd web
npm install
npm run dev      # http://localhost:3001
```

Port **3001** is used on purpose (3000 is left free for other local apps).

## What is real vs demo

- **Engine data** is read from `web/engine-data/` — the genuine evaluation the
  Agent Forge engine recorded (0 unsafe ships, 4/4 good fixes shipped, 3/3 bad
  fixes declined). Surfaces that use it are labelled **"From the engine."**
- **Demo data** is one fictional dataset (`web/lib/fixtures.ts`, company
  "Northwind"). Every Minion and Run on a public page is labelled **"Demo
  data."** No real names, repositories, paths, or credentials appear anywhere
  public.

## Architecture

- **Next.js 15 (App Router) + React 19 + Tailwind v4.** Design tokens live in
  `app/globals.css` (mirrored in `brand/tokens.css`).
- **One shared model** (`lib/types.ts`) rendered everywhere. Two sources feed
  it: `lib/engine-data.ts` (real) and `lib/fixtures.ts` (demo). Components never
  care which.
- **Shared components** (`components/`) are used across marketing, demo, and app
  so nothing can drift: marks, ui primitives, minion card, run timeline, product
  diagram, app shell, demo player.

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Landing page |
| `/demo` | Deterministic guided demo |
| `/forge` | Conversational creation + command workbench |
| `/minions`, `/minions/[id]` | Roster and Minion control surface |
| `/runs`, `/runs/[id]` | Run history and detailed timeline |
| `/activity`, `/settings`, `/about` | Activity feed, settings, product story |

## Honest limitations (this build)

- No user authentication; every surface is public and read-mostly.
- The web app does not call a model directly; the engine does that via the CLI.
- Demo interactions (pause, approve, retry) are session-local and say so; there
  is no web persistence layer yet.
