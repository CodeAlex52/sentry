# Lint incubator

The incubator prevents new violations of selected rules while existing violations are cleaned up. The registry in `oxlint.config.incubator.ts` ships empty. Normal lint remains unchanged.

## Commands

```sh
git fetch origin master
pnpm lint:incubator
pnpm lint:incubator --base HEAD
pnpm lint:incubator --base origin/master --json
pnpm lint:incubator:backlog --rule eslint/no-void --file static/app/example.ts
node scripts/lint-incubator.ts snapshot
pnpm lint:incubator:test
```

`check` scans the current working tree and the resolved base commit with the current incubator rules and installed toolchain. Its default base is `origin/master`; fetch it first to include recent cleanup. `--base HEAD` checks only uncommitted changes. An unavailable base fails, including with an empty registry. Exit codes are 0 for no introduced findings, 1 for introduced findings, and 2 for invalid arguments, unavailable source, or scan errors.

`backlog` emits live JSON and supports exact rule and repository-relative file filters. `snapshot` emits the complete current inventory. `check --json` includes that inventory, the resolved base, and introduced findings. Findings include the rule, location, message, help, URL, and source fingerprint. The revision identifies HEAD; local commands include uncommitted working-tree changes.

All scans cover `static/` and reuse the main lint ignore patterns. Initial enrollment supports syntax-only rules. Type-aware rules and rules that resolve imports need complete project context and must extend the export and verification before enrollment. The base is exported to a temporary directory without changing the checkout or installing dependencies. Both scans use the proposed rule configuration, so first enrollment and rule changes compare both sides consistently. An empty registry avoids running oxlint.

## Source identity

Each diagnostic is associated with its smallest complete enclosing TypeScript statement. Its fingerprint includes the canonical rule name, diagnostic message, exact statement source, and every diagnostic label's relative byte position and length. Diagnostics without an enclosing statement use the complete source file. Unicode byte offsets are converted before looking up TypeScript nodes.

Occurrences match one-to-one, first within the same path and then across moved source. Splitting a file or moving an unchanged statement preserves its allowance. Copying it while retaining the original needs another allowance. Deleting one violation and introducing a different one fails even if the file count stays constant. Identical duplicated source has interchangeable allowances; deleting and recreating the exact same statement cannot be distinguished from moving it.

Blank lines outside a statement preserve its identity. Formatting, comments, or other changes inside a statement conservatively create a new identity, even if the underlying violation already existed. Fix the finding or split the cleanup from the refactor. There are no count overrides or baseline regeneration commands.

## Enrollment and graduation

1. Add a canonical rule key such as `eslint/no-void` with severity `error` to the empty `rules` registry. Rule options use `['error', options]`. Register any additional plugin explicitly. Do not inherit the normal lint rules or overrides.
2. Run the integration test and inspect a full live backlog. Check the rule's diagnostics against realistic source, including file moves and Unicode. Custom plugins must resolve with the current installed dependencies; enrollment should test any plugin-specific project settings on the exported base as well.
3. Review the configuration change separately from cleanup when practical. Existing findings are grandfathered by scanning the exact base with the newly enrolled rule.
4. Fix debt in ordinary PRs. Each merge immediately removes those source allowances from subsequent checks.
5. When the backlog is empty, enable the rule in normal lint and remove it from the incubator in the same change. Run normal lint and the incubator tests.

Keep infrastructure and registry changes under the existing JS build owners' review. A failing gate is not a reason to disable a rule, add ignores, or weaken identity matching.

## CI and master records

The unconditional `lint-incubator` job is part of the required Frontend check. On PRs, GitHub checks out the synthetic merge commit. Like `type-coverage-diff.yml`, the incubator uses `HEAD^1`, the exact base branch tip used for that merge. It does not use the historical merge base, the PR's previous commit, or a fetched tip that might have advanced. Failure to resolve that parent fails the job.

Each master push records a complete JSON inventory under `lint-incubator-<commit SHA>` with 30-day artifact retention. PR checks upload their inventory and introduced findings even when findings fail the gate. Records are audit artifacts, never enforcement inputs. No nightly shrink job, committed baseline, bot PR, or writable GitHub token is needed.

Unrelated changes to master do not require a new baseline check. A PR needs revalidation when master removes an allowance it relies on or changes the lint policy. This workflow does not invalidate an existing green check in those cases, so stale PRs can restore removed debt under the current merge policy. Selective revalidation remains a rollout requirement; strict up-to-date checks or a merge queue are broader alternatives. The required Frontend aggregate rejects a failed, cancelled, or skipped incubator job.
