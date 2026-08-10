# Contributing to Agent Forge

Thanks for your interest. Agent Forge is two things in one repository: a
TypeScript engine (CLI + Slack) and a Next.js web product that renders it.

## Getting started

**Engine (repo root)**
```
npm install
cp .env.example .env.local   # add ANTHROPIC_API_KEY
npm test                     # run the unit suite
npm run forge -- build "..." # try Forge from the CLI
```

**Web product (`web/`)**
```
cd web
npm install
npm run dev                  # http://localhost:3001
```

## Principles

- **Prove it in the running product.** Do not mark UI work done from code
  inspection; verify it in the browser, including mobile, dark theme, and
  failure states.
- **Never show success the backend has not confirmed.** A green state must come
  from a real result, never a model claim.
- **Keep public data fictional.** Public pages, fixtures, and screenshots use
  the invented Northwind dataset. No real names, repos, paths, or credentials.
- **One shared model.** Marketing, demo, and app render the same types from
  `web/lib/types.ts`. Do not build marketing mockups that can drift.
- **Small, focused commits.** Run the build and tests before committing.

## Pull requests

Open a PR against `main` with a clear description and, for UI changes, a
before/after screenshot. Accessibility and build checks should pass.
