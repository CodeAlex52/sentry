# Scraps

Scraps owns the isolated design-system components, themes, tokens, and tests in
[src](./src). The remaining components and their MDX stories live in
[the app](../../app/components/core).

## Use package sources in Sentry

TypeScript, Rspack, Jest, and Figma resolve `@sentry/scraps/*` from `src` first,
then fall back to `static/app/components/core/*` for unmigrated modules. The
app keeps the exact `@sentry/scraps/text` alias on the core barrel while it still
exports `Prose`. The core `code` and `hotkey` barrels also remain in the app.
These barrels re-export migrated implementations from the package.

Move components and their tests into `src` as they become isolated. Stories
remain in the app. Once all components are migrated, remove the core fallback
and use a workspace dependency.

The [Scraps contribution guide](../../app/components/core/overview/contributing.mdx)
identifies Figma as the source of truth for design tokens. Change tokens through
that source process.

## Test the package

From the repository root:

```sh
pnpm --dir static/packages/scraps test
pnpm --dir static/packages/scraps typecheck
```

Tests import `render` and `renderHook` from `test/env`; both include the default
light-theme provider. Jest setup and the copied `getEmotionRules` helper also
live under `test/env`. No Sentry providers or test aliases are used.

## Build and pack

```sh
pnpm --dir static/packages/scraps pack --pack-destination .artifacts
```

The `prepack` hook builds JavaScript and declarations with
[Rslib](./rslib.config.mjs), including from a clean checkout. Only `dist`, the
package manifest, README, and license ship.

The `exports` field in [package.json](./package.json) defines the published API.
Add an entry only when its runtime and type dependencies belong to the package
or are declared dependencies. App stories cover more components than this API;
for example, the hotkey story uses both `Hotkey` and `Kbd`, but only `Kbd` is
isolated. Published consumers have no fallback to app components.

## Verify the package

```sh
pnpm --dir static/packages/scraps verify
```

Verification deletes `dist` before packing to exercise `prepack`, checks the
tarball contents and dependencies, typechecks and imports each public export,
and server renders representative components in both themes.

Consumers provide Emotion's `ThemeProvider` with `lightTheme` or `darkTheme`.
The package does not include application providers, global CSS, or fonts.

## Prepare a release

Add a nonempty `## <version>` section to [CHANGELOG.md](./CHANGELOG.md), then
run the `Prepare Scraps release` GitHub workflow with that version. The initial
entry is `0.1.0`. Craft's `simple` policy rejects a release without a matching
entry.

Craft creates a `scraps/release/<version>` branch and opens a request in
`getsentry/publish`. The package workflow verifies that branch and uploads its
npm tarball. A release manager must approve the request before Craft publishes.
The Sentry Docker release uses the root `.craft.yml`.
