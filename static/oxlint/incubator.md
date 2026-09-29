# Lint incubator

The incubator is opt-in tooling for comparing new violations of selected rules against existing findings. It does not run in prek, normal lint, or CI. The registry in `oxlint.config.incubator.ts` enrolls `@sentry/scraps/prefer-primitives`. Normal lint remains unchanged.

## Commands

```sh
git fetch origin master
pnpm lint:incubator
pnpm lint:incubator --base HEAD
pnpm lint:incubator --base origin/master --json
pnpm lint:incubator:backlog
pnpm lint:incubator:snapshot
pnpm lint:incubator:test
```

`check` scans the current working tree and the resolved base commit with the current incubator rules and installed toolchain. Locally, its default base is the unique merge base of `HEAD` and locally fetched `origin/master`. This checks branch changes without blaming an older checkout for changes made only on master. It requires no network or GitHub API access. Explicit `--base` uses that exact commit; `--base HEAD` checks only uncommitted changes. An unavailable or ambiguous base fails, including with an empty registry. Exit codes are 0 for no introduced findings, 1 for introduced findings, and 2 for invalid arguments, unavailable source, or scan errors.

Use `pnpm lint:incubator --changed` to scan changed files on both sides, including deleted sources and new untracked files. This preserves move allowances while rejecting copies. Identical files would consume their own allowances, so omitting them preserves the comparison. Configuration, dependency, or ignore-file changes require full scans. This command checks the working tree, including staged and unstaged changes; it is not a commit hook.

`backlog` emits live JSON and supports exact rule and repository-relative file filters. `snapshot` emits the complete current inventory. `check --json` includes that inventory, the resolved base, and introduced findings. Findings include the rule, location, message, help, URL, and source fingerprint. The revision identifies HEAD; local commands include uncommitted working-tree changes.

Scans cover `static/` and reuse the main lint ignore patterns. Initial enrollment supports syntax-only, file-local rules so unchanged files can safely be omitted from local checks. Type-aware rules and rules that resolve imports or depend on other files need complete project context and must extend the export and verification before enrollment. The base is exported to a temporary directory without changing the checkout or installing dependencies. Both scans use the proposed rule configuration, so first enrollment and rule changes compare both sides consistently. An empty registry avoids running oxlint. Full checks, backlog queries, and snapshots retain complete inventories.

## Offline baseline cache

Local checks reuse full base inventories in `.artifacts/lint-incubator/baselines/`. A miss scans the base once; later checks scan only the current source. The cache key includes the exact base, resolved lint policy, plugin source, incubator implementation, and requested and installed toolchain identities. Changing any of these rebuilds the baseline. For changed-file checks, only matching paths from the cached inventory supply allowances.

Cache files are optional: missing, invalid, unreadable, or unwritable entries fall back to scanning. Writes are atomic. Deleting the cache is safe. The cache assumes package-manager-installed dependencies are immutable and enrolled rules are deterministic and file-local. Plugins outside the hashed repository plugin tree, symlinked plugin trees, or installations without dependency metadata bypass caching. Setting `GITHUB_ACTIONS=true` bypasses the local cache and verifies source directly. No cache operation accesses the network.

## Source identity

Each diagnostic is associated with its smallest complete enclosing TypeScript statement. Its fingerprint includes the canonical rule name, diagnostic message, exact statement source, and every diagnostic label's relative byte position and length. Diagnostics without an enclosing statement use the complete source file. Unicode byte offsets are converted before looking up TypeScript nodes.

Occurrences match one-to-one, first within the same path and then across moved source. Splitting a file or moving an unchanged statement preserves its allowance. Copying it while retaining the original needs another allowance. Deleting one violation and introducing a different one fails even if the file count stays constant. Identical duplicated source has interchangeable allowances; deleting and recreating the exact same statement cannot be distinguished from moving it.

Blank lines outside a statement preserve its identity. Formatting, comments, or other changes inside a statement conservatively create a new identity, even if the underlying violation already existed. Fix the finding or split the cleanup from the refactor. There are no count overrides or baseline regeneration commands.

## Enrollment and graduation

1. Add a canonical rule key such as `eslint/no-void` with severity `error` to the `rules` registry. Rule options use `['error', options]`. Register any additional plugin explicitly. Do not inherit the normal lint rules or overrides.
2. Run the integration test and inspect a full live backlog. Check the rule's diagnostics against realistic source, including file moves and Unicode. Custom plugins must resolve with the current installed dependencies; enrollment should test any plugin-specific project settings on the exported base as well.
3. Review the configuration change separately from cleanup when practical. Existing findings are grandfathered by scanning the exact base with the newly enrolled rule.
4. Fix debt in ordinary PRs. Checks stop allowing cleaned-up findings when the selected base includes that cleanup. Existing branches keep their historical merge base until they incorporate newer master changes.
5. When the backlog is empty, enable the rule in normal lint and remove it from the incubator in the same change. Run normal lint and the incubator tests.

Keep infrastructure and registry changes under the existing JS build owners' review. When evaluating findings, fix new violations rather than weakening the registry or identity matching.

## Future automatic enforcement

Automatic hooks, CI checks, and master snapshot jobs are deferred until the local check fits the per-commit performance budget. The package scripts are available for explicit experiments; this change adds no required checks or background jobs.

A future PR check should compare the synthetic merge checkout against its exact first parent, `HEAD^1`, as in `type-coverage-diff.yml`. It must also handle checks becoming stale when master removes an allowance or changes lint policy, without requiring every PR to be up to date. The CLI supports an explicit `--base` for that comparison.

## First tenant: prefer-primitives

`@sentry/scraps/prefer-primitives` runs only when the incubator is invoked explicitly. It is disabled in normal lint, prek, and CI. The rule-specific override excludes `static/app/components/core/**`, where the primitives themselves implement these styles. Other incubator rules keep their own scope.

The rule reports one finding per style definition, including a shared `const` used more than once. It recognizes intrinsic Emotion `styled` templates/calls and intrinsic JSX `css`/`style` values. Emotion imports and variable references resolve through lexical bindings, including aliases and forward declarations. Unrelated object data and styles used only on custom components are not candidates.

| Evidence                                                                      | Suggested component                                   |
| ----------------------------------------------------------------------------- | ----------------------------------------------------- |
| Native `button`                                                               | `Button` from `@sentry/scraps/button`                 |
| Native `h1`–`h6`                                                              | `Heading` from `@sentry/scraps/text`, preserving `as` |
| Explicit flex/inline-flex and column direction                                | `Stack` from `@sentry/scraps/layout`                  |
| Explicit flex/inline-flex                                                     | `Flex` from `@sentry/scraps/layout`                   |
| Explicit grid/inline-grid                                                     | `Grid` from `@sentry/scraps/layout`                   |
| Two supported typography declarations on span, p, label, div, time, or legend | `Text` from `@sentry/scraps/text`                     |
| Two physical padding, border-radius, or background-color declarations         | `Container` from `@sentry/scraps/layout`              |

Layout suggestions are limited to the tags supported by `ContainerElement`, so they do not suggest replacing links, inputs, or SVG elements. Container replaces the upstream rule's obsolete Box suggestion. Margins, logical padding/radii, and unsupported typography such as letter spacing or hyphens do not establish a candidate. Typography evidence includes size, line height, color, current regular/medium font weights, monospace, and supported alignment, italic, uppercase, decoration, and wrapping values. Layout selection takes precedence over Text and Container; raw button and heading semantics take precedence over layout styles.

There is no autofix. Choose tokens, preserve intrinsic semantics and unsupported styles, and review form behavior manually. `Button` defaults to `type="button"`; a native button may submit its form. `Heading` requires the original heading level through `as`.

CSS templates use the installed styled-syntax parser without concatenating interpolation fragments. Nested rules, comments, and quoted CSS-like strings do not count as root declarations. Dynamic display values, arbitrary interpolated style fragments, object spreads/computed keys, multi-argument composition, imported style objects, mutable bindings, escaping or property-accessed style objects, CSS `all` resets or `!important`, JSX prop spreads or mixed css/style attributes, and block-bodied callbacks are conservatively skipped. Syntax-only matching does not prove that every value or behavior can be represented by primitive props.
