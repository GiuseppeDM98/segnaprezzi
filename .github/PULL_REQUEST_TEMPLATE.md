# Summary

<!-- What does this PR do, and why? One or two sentences. -->

## Linked issue

<!-- "Closes #123" for issues, or a link to the Discussion that agreed on this
change. -->

## Type of change

<!-- Check one. The PR title must be a Conventional Commit subject with the
matching type — it becomes the squash-merge commit message. -->

- [ ] `feat` — new feature
- [ ] `fix` — bug fix
- [ ] `refactor` — no behavior change
- [ ] `chore` — tooling, dependencies, config
- [ ] `docs` — documentation only
- [ ] `test` — tests only

## Checklist

- [ ] PR title follows [Conventional Commits](https://www.conventionalcommits.org/) (e.g. `feat: add fuel quick form`)
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm test:e2e` are all green locally
- [ ] New or changed behavior is covered by tests (behavioral, Arrange–Act–Assert)
- [ ] Money stays integer: `total_price_cents` / `unit_price_milli` — no floats hold euros
- [ ] i18n: every new UI string exists in **both** `messages/it.json` and `messages/en.json`
- [ ] UI changes verified in **both light and dark themes**, mobile viewport first
- [ ] Docs updated (`CLAUDE.md`/`AGENTS.md`) if this PR changes documented behavior — n/a otherwise

## Screenshots

<!-- For UI changes: before/after, light + dark. Delete this section otherwise. -->
