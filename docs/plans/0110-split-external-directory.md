---
issue: 110
issue_title: "refactor: split external-directory.ts into focused modules"
---

# Split external-directory.ts into focused modules

## Problem Statement

`src/external-directory.ts` is ~800 lines bundling four unrelated concerns: global node_modules discovery, path classification utilities, prompt/reason message formatting, and a tree-sitter bash parser with AST walker.
These concerns have no coupling to each other and should be independently testable, loadable, and changeable.

## Goals

- Split `src/external-directory.ts` into four focused modules.
- Preserve all existing behavior — pure extraction refactoring, no logic changes.
- Keep `src/external-directory.ts` as a barrel re-export so downstream imports can migrate incrementally.
- Enable independent testing of each concern without pulling in heavy dependencies (tree-sitter, child_process).

## Non-Goals

- Changing any permission logic or policy semantics.
- Deduplicating `normalizePathForComparison` / `isPathWithinDirectory` with `skill-prompt-sanitizer.ts` — that is #109's scope.
- Moving path helpers to `src/path-utils.ts` — if #109 lands first, this plan's path-classification module will be absorbed into it; if #110 lands first, #109 will consume from the module created here.

## Background

The file touches the `external_directory` permission surface.
Current consumers of `src/external-directory.ts`:

|Consumer|Imports used|
|---|---|
|`src/runtime.ts`|`discoverGlobalNodeModulesRoot`|
|`src/handlers/gates/external-directory.ts`|`formatExternalDirectoryAskPrompt`, `formatExternalDirectoryDenyReason`, `formatExternalDirectoryUserDeniedReason`, `getPathBearingToolPath`, `isPathOutsideWorkingDirectory`, `isPiInfrastructureRead`, `normalizePathForComparison`|
|`src/handlers/gates/bash-external-directory.ts`|`extractExternalPathsFromBashCommand`, `formatBashExternalDirectoryAskPrompt`, `formatBashExternalDirectoryDenyReason`, `formatExternalDirectoryHardStopHint`|
|`src/handlers/gates/tool.ts`|`PATH_BEARING_TOOLS`|
|`src/handlers/gates/skill-read.ts`|`normalizePathForComparison`|

Test files:

- `tests/external-directory.test.ts` — tests path utils, discovery, messages, and constants.
- `tests/bash-external-directory.test.ts` — tests tree-sitter path extraction.
- `tests/handlers/gates/external-directory.test.ts` — gate-level integration.
- `tests/handlers/gates/bash-external-directory.test.ts` — gate-level integration.

## Design Overview

Split into four new modules, each owning one concern:

### `src/node-modules-discovery.ts`

- `walkUpToNodeModules()` (internal)
- `discoverGlobalNodeModulesViaSubprocess()` (internal)
- `discoverGlobalNodeModulesRoot()` (exported)

Dependencies: `node:child_process`, `node:fs`, `node:path`, `node:url`.

### `src/path-classification.ts`

- `normalizePathForComparison()` (exported)
- `isPathWithinDirectory()` (exported)
- `isPathOutsideWorkingDirectory()` (exported)
- `getPathBearingToolPath()` (exported)
- `isPiInfrastructureRead()` (exported)
- `isSafeSystemPath()` (exported)
- `SAFE_SYSTEM_PATHS` (exported)
- `PATH_BEARING_TOOLS` (exported)
- `READ_ONLY_PATH_BEARING_TOOLS` (exported)

Dependencies: `node:os`, `node:path`, `./common`.
If #109 lands and creates `src/path-utils.ts`, this module merges into it.

### `src/external-directory-messages.ts`

- `formatExternalDirectoryHardStopHint()` (exported)
- `formatExternalDirectoryAskPrompt()` (exported)
- `formatExternalDirectoryDenyReason()` (exported)
- `formatExternalDirectoryUserDeniedReason()` (exported)
- `formatBashExternalDirectoryAskPrompt()` (exported)
- `formatBashExternalDirectoryDenyReason()` (exported)

Dependencies: none (pure string builders).

### `src/bash-path-extractor.ts`

- All tree-sitter types (`TSNode`, `TSParser`)
- Parser lifecycle (`initParser`, `getParser`, `resetParserForTesting`)
- AST walker (`resolveNodeText`, `collectPathCandidateTokens`, `collectPatternCommandTokens`)
- Pattern-first command config (`PATTERN_FIRST_COMMANDS`, `SKIP_SUBTREE_TYPES`, etc.)
- Token classification (`classifyTokenAsPathCandidate`, `URL_PATTERN`, `REGEX_METACHAR_PATTERN`)
- `extractExternalPathsFromBashCommand()` (exported)

Dependencies: `web-tree-sitter`, `tree-sitter-bash`, `node:module`, `node:path`.
Imports `normalizePathForComparison`, `isPathOutsideWorkingDirectory` from `./path-classification` (or `./external-directory` barrel).

### `src/external-directory.ts` (barrel)

Becomes a thin barrel that re-exports everything from the four new modules.
All existing consumer imports continue to work unchanged.
Downstream consumers can optionally migrate to direct imports in follow-up work.

## Module-Level Changes

### New files

|File|Contents|
|---|---|
|`src/node-modules-discovery.ts`|Global node_modules resolution|
|`src/path-classification.ts`|Path normalization, classification, tool-path helpers|
|`src/external-directory-messages.ts`|6 `format*` pure string builders|
|`src/bash-path-extractor.ts`|Tree-sitter parser, AST walker, `extractExternalPathsFromBashCommand`|

### Changed files

|File|Change|
|---|---|
|`src/external-directory.ts`|Replace implementation with barrel re-exports from four new modules|

### New test files

|File|Contents|
|---|---|
|`tests/node-modules-discovery.test.ts`|Extracted from `tests/external-directory.test.ts` — discovery tests|
|`tests/path-classification.test.ts`|Extracted from `tests/external-directory.test.ts` — path util tests|
|`tests/external-directory-messages.test.ts`|Extracted from `tests/external-directory.test.ts` — message format tests|

### Changed test files

|File|Change|
|---|---|
|`tests/external-directory.test.ts`|Reduced to a thin smoke test verifying the barrel re-exports work, or deleted entirely if all tests migrate|
|`tests/bash-external-directory.test.ts`|Update import from `../src/external-directory` to `../src/bash-path-extractor` (or keep barrel import)|

### No changes needed

|File|Reason|
|---|---|
|`tests/handlers/gates/external-directory.test.ts`|Imports from gate module, not from `external-directory.ts` directly|
|`tests/handlers/gates/bash-external-directory.test.ts`|Same — imports from gate module|
|`src/handlers/gates/*`|All import from `../../external-directory` barrel, which continues to work|
|`src/runtime.ts`|Imports `discoverGlobalNodeModulesRoot` from barrel|
|`schemas/permissions.schema.json`|No schema changes|
|`config/config.example.json`|No config changes|

### Architecture docs

|File|Action|
|---|---|
|`docs/architecture/target-architecture.md`|Check if it references `external-directory.ts` and update to reflect the split|

## Test Impact Analysis

1. **New unit tests enabled by extraction:**
   - `tests/node-modules-discovery.test.ts` can mock `child_process` and `fs` without affecting path-classification tests.
   - `tests/path-classification.test.ts` can run without tree-sitter or subprocess mocks.
   - `tests/external-directory-messages.test.ts` needs zero mocks — pure string assertions.

2. **Existing tests that become redundant:**
   - `tests/external-directory.test.ts` currently tests all four concerns in one file with shared mocks.
     After extraction, its individual test blocks migrate to the three new test files.
     The barrel file itself needs only a re-export smoke test (or can be deleted).

3. **Existing tests that must stay as-is:**
   - `tests/bash-external-directory.test.ts` — exercises `extractExternalPathsFromBashCommand` end-to-end with real tree-sitter.
   - `tests/handlers/gates/*.test.ts` — gate-level integration, unaffected by internal splits.

## TDD Order

### Step 1 — Extract `node-modules-discovery.ts` with tests

1. Create `src/node-modules-discovery.ts` with the discovery functions.
2. Create `tests/node-modules-discovery.test.ts` by extracting `discoverGlobalNodeModulesRoot` tests from `tests/external-directory.test.ts`.
3. Update `src/external-directory.ts` to import-and-re-export from `./node-modules-discovery`.
4. Remove the original implementation from `external-directory.ts`.
5. Verify all tests pass.

Commit: `refactor: extract node-modules-discovery module (#110)`

### Step 2 — Extract `path-classification.ts` with tests

1. Create `src/path-classification.ts` with path helpers and constants.
2. Create `tests/path-classification.test.ts` by extracting path-related tests from `tests/external-directory.test.ts`.
3. Update `src/external-directory.ts` to import-and-re-export from `./path-classification`.
4. Remove the original implementation from `external-directory.ts`.
5. Verify all tests pass.

Commit: `refactor: extract path-classification module (#110)`

### Step 3 — Extract `external-directory-messages.ts` with tests

1. Create `src/external-directory-messages.ts` with the 6 `format*` functions.
2. Create `tests/external-directory-messages.test.ts` by extracting message tests from `tests/external-directory.test.ts`.
3. Update `src/external-directory.ts` to import-and-re-export from `./external-directory-messages`.
4. Remove the original implementation from `external-directory.ts`.
5. Verify all tests pass.

Commit: `refactor: extract external-directory-messages module (#110)`

### Step 4 — Extract `bash-path-extractor.ts`

1. Create `src/bash-path-extractor.ts` with tree-sitter parser, AST walker, and `extractExternalPathsFromBashCommand`.
2. Update `tests/bash-external-directory.test.ts` imports if needed (or keep barrel).
3. Update `src/external-directory.ts` to import-and-re-export from `./bash-path-extractor`.
4. Remove the original implementation from `external-directory.ts`.
5. Verify all tests pass.

Commit: `refactor: extract bash-path-extractor module (#110)`

### Step 5 — Clean up barrel and original test file

1. Verify `src/external-directory.ts` is now a pure barrel of re-exports.
2. Reduce `tests/external-directory.test.ts` to a smoke test (or delete if fully migrated).
3. Run full test suite.

Commit: `refactor: finalize external-directory barrel re-exports (#110)`

### Step 6 — Update architecture docs

1. Update `docs/architecture/target-architecture.md` if it references the monolithic `external-directory.ts`.

Commit: `docs: update architecture for external-directory split (#110)`

## Risks and Mitigations

|Risk|Mitigation|
|---|---|
|Could this silently weaken a permission?|No — pure extraction refactoring; no logic changes; barrel preserves all exports.|
|Circular dependency between `bash-path-extractor` and `path-classification`|`bash-path-extractor` imports from `path-classification`; no reverse dependency. Barrel re-exports both without creating a cycle.|
|#109 overlap on `path-utils.ts`|If #109 lands first, step 2 merges into its `path-utils.ts`. If #110 lands first, #109 consumes from `path-classification.ts`. Both orderings work.|
|Tree-sitter WASM loading breaks after move|`bash-path-extractor.ts` preserves the same `createRequire(import.meta.url)` pattern — `import.meta.url` resolves to the new file's location, but WASM resolution uses `require.resolve` which walks `node_modules`, so it works from any file in `src/`.|
|Test mocks leak across modules|Each new test file has its own `vi.mock()` scope. Discovery tests mock `child_process`/`fs`; path tests mock `os`; message tests need no mocks.|

## Open Questions

- Should downstream consumers (`src/handlers/gates/*`, `src/runtime.ts`) be updated to import directly from the new modules in this PR, or deferred to a follow-up?
  Recommendation: defer — the barrel ensures backward compatibility and keeps the PR focused on extraction.
