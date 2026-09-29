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

`check` scans the current working tree and the resolved base commit with the current incubator rules and installed toolchain. Locally, its default base is the unique merge base of `HEAD` and locally fetched `origin/master`. This checks branch changes without blaming an older checkout for changes made only on master. It requires no network or GitHub API access. Explicit `--base` uses that exact commit; `--base HEAD` checks only uncommitted changes. An unavailable or ambiguous base fails, including with an empty registry. Exit codes are 0 for no introduced findings, 1 for introduced findings, and 2 for invalid arguments, unavailable source, or scan errors.

The `lint-incubator` prek hook runs `check --changed` for changes under `static/`, the incubator script, lint configuration, dependencies, or the hook configuration. It scans changed files on both sides, including deleted sources and new untracked files, preserving move allowances while rejecting copies. Identical files would consume their own allowances, so omitting them preserves the comparison. Configuration, dependency, or ignore-file changes require full scans. New findings fail locally with file locations and rule messages. Like other pre-commit hooks, a commit checks staged content while unstaged changes are temporarily stashed. To run it explicitly, use `.venv/bin/prek run lint-incubator --all-files`. CI checks the merged source against its exact target base, so it also catches restored debt removed on master since the local branch diverged.

`backlog` emits live JSON and supports exact rule and repository-relative file filters. `snapshot` emits the complete current inventory. `check --json` includes that inventory, the resolved base, and introduced findings. Findings include the rule, location, message, help, URL, and source fingerprint. The revision identifies HEAD; local commands include uncommitted working-tree changes.

Scans cover `static/` and reuse the main lint ignore patterns. Initial enrollment supports syntax-only, file-local rules so unchanged files can safely be omitted from local checks. Type-aware rules and rules that resolve imports or depend on other files need complete project context and must extend the export and verification before enrollment. The base is exported to a temporary directory without changing the checkout or installing dependencies. Both scans use the proposed rule configuration, so first enrollment and rule changes compare both sides consistently. An empty registry avoids running oxlint. Full checks, backlog queries, and snapshots retain complete inventories.

## Offline baseline cache

Local checks reuse full base inventories in `.artifacts/lint-incubator/baselines/`. A miss scans the base once; later checks scan only the current source. The cache key includes the exact base, resolved lint policy, plugin source, incubator implementation, and requested and installed toolchain identities. Changing any of these rebuilds the baseline. For changed-file checks, only matching paths from the cached inventory supply allowances.

Cache files are optional: missing, invalid, unreadable, or unwritable entries fall back to scanning. Writes are atomic. Deleting the cache is safe. The cache assumes package-manager-installed dependencies are immutable and enrolled rules are deterministic and file-local. Plugins outside the hashed repository plugin tree, symlinked plugin trees, or installations without dependency metadata bypass caching. CI bypasses the local cache and verifies source directly; master artifacts remain audit records. No cache operation accesses the network.

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
