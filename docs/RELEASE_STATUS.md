# Release status — `@sycghj/pi-permission-system` (n-day release slice)

Last updated: 2026-07-29 (release/s1-n-day cut from upstream/main 24.0.0, conflicts resolved, pre-existing Windows test gaps documented)

This file is the **local** source of truth for what is shippable vs experimental in the n-day fork release.
It does not replace upstream gotgenes docs.

**Runtime note:** Pi path-installs `F:\code\pi\pi-packages\packages\pi-permission-system` (live tree).
The release artifact is branch `release/s1-n-day` on the `sycghj/pi-packages` fork.

## Release slice — `release/s1-n-day` v24.1.0

**Package:** `@sycghj/pi-permission-system` **24.1.0** (fork of `gotgenes/pi-packages` `upstream/main` @ 24.0.0 + `fbdcbc1` ask-branch autoMode).

**Channel priority:** GitHub first (`sycghj/pi-packages` fork, annotated tag `v24.1.0` + Release); npm deferred (no npm account yet).

### Branch construction
1. `release/s1-n-day` cut from `upstream/main` (gotgenes 24.0.0 base).
2. `git cherry-pick --no-commit fbdcbc1` (ask-branch autoMode) — 5 conflicts resolved additively (authorizerChain + autoMode coexist).
3. Dirty stash popped on top — 6 conflicts resolved (forwarding/wildcard code-level, see Path-handling resolution below).
4. `pi-subagents` agent-picker WIP isolated to `wip/pi-subagents-agent-picker` (NOT in this release).

### Slice boundary (what ships)
- **S0** static permission base (allow/ask/deny, bash wildcards, path + external_directory, fail-closed, subagent forwarding, `getPermissionsService()` + event bus, session approvals) — from upstream.
- **S1** ask-branch `autoMode` (LLM classifier for `ask` only; `allow`/`deny` bypass; default `enabled: false`; `fallback: "ask"`).
- **S2** `autoMode.twoStage` thinking review (default `enabled: false`; kept in tree, opt-in only).
- **Worktree** portable-path forwarding (`ForwardedPortablePath`), same-repo worktree external_directory suppression.
- **authorizerChain** (from upstream 24.0.0) — live-authority chain, opt-in, coexists with autoMode.

### Slice boundary (NOT marketed, kept as dead code default-off)
- **S3 learning** — `src/learning/**`, evidence recorder, learned-grant evaluator, `learning` config (default `enabled: false`, `mode: "shadow"`), `riskOverrides`.
  - **Decision C (user-confirmed 2026-07-29):** learning is kept in-tree as dead code (default off) rather than physically excluded. Rationale: learning modules (`bash-command-shape`, `capability-fingerprint`, `bash-capability-extractor`) are shared infrastructure used by worktree / tool-call-gate-pipeline; physically removing them is a high-risk refactor. Runtime `learningEnabled` guards all paths; config default off; not exported as a product feature. RELEASE_STATUS marks it experimental.

## Path-handling resolution (surgical hybrid)

The stash and upstream had divergent path-handling designs. Resolution (per code analysis 2026-07-29):

| File | Resolution | Why |
| --- | --- | --- |
| `src/wildcard-matcher.ts` | **Upstream** (kept `matches()` encapsulation + `foldSeparators` value-fold) | Stash's raw-regex `flexibleSeparators` is redundant given `foldSeparators`+`windowsSeparators`; drops #653 regression tests; re-exposes pattern/value asymmetry |
| `src/expand-home.ts` | **Stash** (separator-preserving `joinHome`) | Upstream's ambient `join` violates `PathFlavor` injection design — breaks cross-flavor tests on Windows; stash's fix is a real bugfix |
| `src/path/pi-infrastructure-read.ts` | **Stash** (routes through `flavor.impl.join`) | Same class of `PathFlavor`-violation fix |
| `test/*.test.ts` flavor-injections | **Stash** (inject `posixPathFlavor` / `"linux"` for determinism) | Fixes 44 of upstream's 59 win32 failures; cross-platform-deterministic |
| `test/wildcard-matcher.test.ts` home tests | **Fixed** (5 lines: `join(...)` → literal `/` paths) | Match stash's separator-preserving expandHomePath |
| `test/handlers/gates/external-directory.test.ts` | **Fixed** (1 line: `pathFlavorForPlatform` → `posixPathFlavor`) | Match the gate's `posixPathFlavor` |

## Release gate status

| Gate | Command | Status |
| --- | --- | --- |
| TypeScript | `tsc --noEmit` | ✅ 0 errors |
| Lint | `biome check . && eslint . && rumdl check` | ✅ pass |
| Public types | `pnpm run verify:public-types` | ✅ self-contained, consumer type-checks |
| Tests | `vitest run` | ⚠️ 17 pre-existing Windows-env failures (see below) |

## Pre-existing Windows test gaps (17 failures, NOT introduced by this fork)

Upstream `gotgenes/pi-packages` CI runs **Linux only** (`ubuntu-latest`); it has never run on Windows.
Pure `upstream/main` on this Windows machine produces **59 path-handling test failures**.
This fork's surgical-hybrid resolution **reduced them to 17** (fixed 42).

The remaining 17 are all Windows-environment-specific (not logic regressions):

| Category | Count | Root cause | Files |
| --- | --- | --- | --- |
| chmod owner-only | 9 | Windows doesn't support Unix `chmod 0600` owner-only semantics | `log-file-permissions.test.ts`, `extension-config.test.ts`, `logging.test.ts`, `authority/forwarding-io.test.ts` |
| bash/program symlink + case | 5 | Windows case-insensitive path folding + symlink creation perms | `access-intent/bash/program.test.ts` |
| permission-manager real-home | 3 | `homedir()` real path + case folding | `permission-manager-unified.test.ts` |

**These are NOT blockers for the n-day release** — they are inherited upstream Windows CI gaps.
Fixing upstream's Windows test coverage should be a separate PR to `gotgenes/pi-packages` (add Windows to CI matrix / make tests platform-deterministic).
The n-day validation is runtime-log-based (51914-line `permission-review` log; auto-mode 93.4% allow rate, 379 two-stage events).

## Git hygiene for release

1. Branch `release/s1-n-day` — permission-system only, no `pi-subagents`.
2. Logical commits: schema → config → autoMode core → twoStage → worktree → docs → version bump.
3. Annotated tag `v24.1.0`.
4. GitHub Release on `sycghj/pi-packages` (no tarball upload; npm deferred).

## Open product decisions

| Decision | Resolution |
| --- | --- |
| May **project** config set `autoMode.enabled: true`? | **No** — user/global only; project can only tighten |
| Default `fallback` | `"ask"` |
| S2 in same release as S1? | **Yes** (kept in-tree, default `enabled: false`, opt-in only) |
| Learning in release? | **Decision C** — kept as dead code (default off), not physically excluded |
| `autoMode.twoStage.enabled` default | `false` |
| `autoMode.enabled` default | `false` |
| Publish from `sycghj` fork | **Yes** — `@sycghj/pi-permission-system` (GitHub first, npm deferred) |
| Symbol keys (`Symbol.for("@gotgenes/...")`) | **Kept as `@gotgenes/`** for interop with upstream-compatible extensions |

## CHANGELOG (24.1.0)

See `CHANGELOG.md` — marks fork + divergence + n-day slice boundary.
