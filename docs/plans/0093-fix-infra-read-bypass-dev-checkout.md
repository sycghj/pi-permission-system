---
issue: 93
issue_title: "Infrastructure read bypass fails in local development checkout"
---

# Fix infrastructure read bypass in local development checkout

## Problem Statement

`discoverGlobalNodeModulesRoot()` walks up from the extension's own `import.meta.url` to find a `node_modules` ancestor directory.
When the extension is globally installed this works — the walk finds e.g. `/opt/homebrew/lib/node_modules`.
When running from a local development checkout (e.g. `/Users/chris/development/pi/pi-permission-system`), there is no `node_modules` ancestor, so the function returns `null`.
This causes `piInfrastructureDirs` to omit the global `node_modules` root, and skill file reads trigger unexpected external-directory permission prompts.

## Goals

- Make `discoverGlobalNodeModulesRoot()` find the global `node_modules` root even when the extension itself is not installed inside it.
- Eliminate spurious external-directory prompts for skill file reads during local development.
- Keep the existing walk-up-from-self as the primary strategy (zero subprocess overhead for production installs).

## Non-Goals

- Upstream API request for `getGlobalNpmRoot()` — useful but orthogonal (tracked in #48 discussion).
- Changing `piInfrastructureReadPaths` config semantics — the manual workaround stays as-is.
- Supporting exotic package manager layouts beyond npm/pnpm/bun/Homebrew — cover the common cases, degrade gracefully for the rest.

## Background

### Relevant modules

- `src/external-directory.ts` — `discoverGlobalNodeModulesRoot()` (the broken function), `isPiInfrastructureRead()`.
- `src/runtime.ts` — `createExtensionRuntime()` calls `discoverGlobalNodeModulesRoot()` once at construction and stores the result in `piInfrastructureDirs`.
- `src/handlers/tool-call.ts` — combines `piInfrastructureDirs` with `config.piInfrastructureReadPaths` and passes them to `isPiInfrastructureRead()`.

### Permission surface

`special.external_directory` — the external-directory gate for path-bearing tools.

### Existing workaround

Users can add the global `node_modules` path to `piInfrastructureReadPaths` in their config, but this is non-obvious and machine-specific.

## Design Overview

### Strategy: `createRequire` fallback

When the walk-up-from-self strategy returns `null` (no `node_modules` ancestor), use `createRequire(import.meta.url)` to resolve a known globally-installed package (`@mariozechner/pi-coding-agent`) and walk up from *that* resolved path.

`createRequire` follows the standard Node.js module resolution algorithm, so it will find the package in the global `node_modules` regardless of where the extension code lives.
`@mariozechner/pi-coding-agent` is always available at runtime — it's the host SDK.

```typescript
function discoverGlobalNodeModulesRoot(fromUrl = import.meta.url): string | null {
  // Strategy 1: walk up from own location (covers global installs).
  const fromSelf = walkUpToNodeModules(fromUrl);
  if (fromSelf) return fromSelf;

  // Strategy 2: resolve a known global package via createRequire.
  try {
    const require = createRequire(fromUrl);
    const sdkEntry = require.resolve("@mariozechner/pi-coding-agent");
    return walkUpToNodeModules(pathToFileURL(sdkEntry).href);
  } catch {
    return null;
  }
  // Both strategies failed — caller degrades gracefully.
}
```

The inner `walkUpToNodeModules` is the existing walk-up loop, extracted to a helper so both strategies reuse the same logic.

### Why not `npm root -g`?

Subprocess calls at startup add latency and can fail silently in restricted environments.
The `createRequire` approach is synchronous, zero-subprocess, and uses the same resolution Node.js itself uses.

### Why `@mariozechner/pi-coding-agent`?

It is always present (it's the host), already imported, and its resolved path is inside the global `node_modules` tree.
If it somehow fails to resolve (shouldn't happen), the `catch` returns `null` and the caller degrades gracefully — same as today.

### Edge cases

- **pnpm virtual store**: `createRequire` may resolve to a `.pnpm` store path.
  Walking up from that path will still find a `node_modules` ancestor (the `.pnpm` directory is under `node_modules`).
- **Bundled/vendored extension**: if the extension is bundled into a single file outside `node_modules`, the walk-up fails.
  The `createRequire` fallback still works because the SDK package is globally installed.
- **`createRequire` resolves to a symlink target**: `require.resolve` returns the real path, which is inside the actual `node_modules` tree.
  This is correct — symlink targets are what we want.

## Module-Level Changes

### `src/external-directory.ts`

- Extract the walk-up loop into a private `walkUpToNodeModules(fromUrl: string): string | null` helper.
- Add the `createRequire` fallback to `discoverGlobalNodeModulesRoot()` when the walk-up returns `null`.
- Import `pathToFileURL` from `node:url` (already importing `fileURLToPath`).

### `tests/external-directory.test.ts`

- Add tests for the `createRequire` fallback path:
  - Returns the global `node_modules` root when the walk-up-from-self fails but `createRequire` resolves the SDK.
  - Returns `null` when both strategies fail.
  - Does not invoke the fallback when the walk-up-from-self succeeds (primary path is preferred).

### `tests/runtime.test.ts`

- No changes needed — the existing mock of `discoverGlobalNodeModulesRoot` covers the runtime's consumption of the return value.
  The new fallback logic is internal to `discoverGlobalNodeModulesRoot` and tested in `external-directory.test.ts`.

### No changes needed

- `src/runtime.ts` — no API change; it already calls `discoverGlobalNodeModulesRoot()` and handles `null`.
- `src/handlers/tool-call.ts` — no change; it already combines `piInfrastructureDirs` with config paths.
- `schemas/permissions.schema.json` — no config field changes.
- `config/config.example.json` — no config field changes.
- `docs/architecture/` — no architecture doc describes `discoverGlobalNodeModulesRoot` in detail.

## TDD Order

1. **test: cover `createRequire` fallback in `discoverGlobalNodeModulesRoot`**
   Add tests in `tests/external-directory.test.ts`:
   - Walk-up-from-self succeeds → returns result without invoking fallback.
   - Walk-up-from-self fails, `createRequire` resolves SDK to a path inside `node_modules` → returns that `node_modules` root.
   - Walk-up-from-self fails, `createRequire` throws → returns `null`.
   Commit: `test: cover createRequire fallback for global node_modules discovery`

2. **feat: add `createRequire` fallback to `discoverGlobalNodeModulesRoot`**
   Extract `walkUpToNodeModules` helper, add fallback logic.
   Commit: `fix: discover global node_modules root from dev checkout via createRequire fallback`

3. **docs: note the fallback in plan retro / README if needed**
   The README already documents `piInfrastructureReadPaths` as the manual workaround.
   Add a brief note that the automatic discovery now works from dev checkouts.
   Commit: `docs: note createRequire fallback for dev checkout infrastructure reads`

## Risks and Mitigations

|Risk|Mitigation|
|----|----------|
|`createRequire` resolves to an unexpected location, widening the auto-allow set|The walk-up still requires finding a directory literally named `node_modules`. If the resolved path is not inside a `node_modules` tree, the walk-up returns `null` — no widening.|
|Could this silently weaken a permission?|No. The change only affects which directories are added to `piInfrastructureDirs`, and only for *read-only* tools via `isPiInfrastructureRead`. Writes are never bypassed. The auto-allow is restricted to `READ_ONLY_PATH_BEARING_TOOLS`.|
|`@mariozechner/pi-coding-agent` is not resolvable in some future environment|The `catch` returns `null`, identical to current behavior. No regression.|
|Performance regression from `createRequire` + `require.resolve`|These are synchronous, single-call, and only invoked when the primary walk-up fails (i.e., dev checkout only). Zero impact on production installs.|

## Open Questions

- If pnpm's virtual store layout places the resolved SDK path outside the *logical* global `node_modules`, the walk-up might find a store-internal `node_modules` rather than the top-level one.
  This is acceptable — the store-internal path still covers the skill file locations.
  Can revisit if a concrete pnpm layout breaks.
