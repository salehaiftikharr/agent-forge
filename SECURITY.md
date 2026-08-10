# Security

Agent Forge is designed around a few security boundaries. If you find a way to
cross one, please report it.

## Reporting a vulnerability

Open a private security advisory on the GitHub repository, or email the
maintainer listed on the profile. Please do not open a public issue for a
vulnerability until it has been addressed.

## The boundaries the product depends on

- **Minions cannot edit the tests they are judged against.** The verification
  gate reads the test suite; a minion has no write tool that can reach it.
- **Write-class actions are gated.** Anything that writes (patches, pull
  requests, guarded commands) pauses for approval, and approvals are enforced
  by the engine at execution time, not by trusting model output.
- **Runs are sandboxed.** A minion operates on a clone of the repository, not
  the working tree, with a deny-by-default command policy and path containment.
- **Secrets stay out of the tree.** API keys are read from the environment; see
  `.env.example`. Never commit real credentials.

## Scope of the web product in this build

The `web/` application is a read-mostly product surface. It does not implement
user authentication, and it does not call a model directly; the engine does
that via the CLI. Public pages use a fictional dataset. Do not deploy the web
app as if it enforced access control until authentication is added.
