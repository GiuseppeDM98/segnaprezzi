# Security Policy

## Supported versions

segnaprezzi is pre-release software. Until a tagged 1.0 release exists, only
the **`main`** branch is supported — security fixes land there and are not
backported anywhere.

| Version | Supported |
|---|---|
| `main` | ✅ |
| anything else | ❌ |

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report vulnerabilities privately through GitHub's private vulnerability
reporting: go to the repository's **Security** tab → **Report a vulnerability**
(direct link:
[github.com/GiuseppeDM98/segnaprezzi/security/advisories/new](https://github.com/GiuseppeDM98/segnaprezzi/security/advisories/new)).

Include what you can: affected route or module, reproduction steps, impact
assessment, and a suggested fix if you have one.

### What to expect

This project is maintained by a solo maintainer in their spare time, so
response times are **best effort**: you should normally get an acknowledgment
within a week, and triage shortly after. Valid reports are fixed on `main` as a
priority, credited in the advisory (unless you prefer otherwise), and disclosed
once a fix is available. Please allow a reasonable window for a fix before any
public disclosure.

## Scope notes

Things that are useful to know before reporting:

- **Per-user privacy is a core invariant.** Every query is scoped by `user_id`;
  any way for one authenticated user to read or write another user's stores,
  products, price entries, or photos is a vulnerability — report it.
- **Server-side secrets stay server-side.** The Claude API key
  (`ANTHROPIC_API_KEY`) and the session secret (`BETTER_AUTH_SECRET`) must
  never reach the client. Any leak of these through a bundle, response, or log
  is a vulnerability.

### Self-hosted instances

segnaprezzi is self-hostable, and the operator of an instance is responsible
for its configuration:

- Keep `ANTHROPIC_API_KEY` and `BETTER_AUTH_SECRET` secret. Set them as
  environment variables in your hosting platform; never commit them (`.env*`
  files are gitignored for a reason). Rotate them if you suspect exposure.
- Running a private instance for yourself or your household? Create your
  account(s), then set `SIGNUP_ENABLED=false` to close registration — otherwise
  anyone who finds your URL can sign up and consume your Claude API budget.
- Misconfiguration of an individual self-hosted instance (weak secrets, open
  signup on a public URL, leaked tokens) is the operator's responsibility, not
  a vulnerability in segnaprezzi. Vulnerabilities in the code that make a
  correctly configured instance unsafe absolutely are — report those.
- Vulnerabilities in upstream dependencies (Next.js, Better Auth, Drizzle, …)
  should be reported upstream; a report here is still welcome if segnaprezzi
  needs an urgent version bump or workaround.
