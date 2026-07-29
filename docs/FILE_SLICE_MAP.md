# File → release slice map (local organize)

Use this when staging commits or building a PR.
Paths relative to `packages/pi-permission-system/`.

## S1 — Ask-branch autoMode (ship candidate)

### Docs

- `docs/RELEASE_STATUS.md` (meta)
- `docs/FILE_SLICE_MAP.md` (meta)
- `docs/auto-mode-progress.md`
- `docs/session-progress-2026-07-20.md` (session notes; optional in npm)
- `README.md` (autoMode section only — review whole-file diff)
- `schemas/permissions.schema.json` (autoMode fields)

### Core auto mode

- `src/auto-mode-classifier.ts`
- `src/auto-mode-composition.ts`
- `src/auto-mode-eval.ts`
- `src/auto-mode-observer.ts`
- `src/auto-mode-request.ts`
- `src/auto-mode-runtime-context.ts`
- `src/auto-mode-runtime-summary.ts`
- `src/capability-projection.ts`
- `src/handlers/gates/auto-ask-decider.ts`
- `src/handlers/gates/runner.ts` (ask → decider)
- `src/handlers/gates/tool.ts` / `descriptor.ts` (safety-floor / classifierApprovable)
- `src/handlers/gates/tool-call-gate-pipeline.ts`
- `src/config-schema.ts`, `extension-config.ts`, `config-loader.ts`, `config-store.ts`, `config-modal.ts`
- `src/index.ts` (wire decider only)
- `src/permission-events.ts` (if only auto_mode / related)

### Worktree / external-dir portability (if included in same PR)

- `src/worktree-runtime-context.ts`
- `src/handlers/gates/readonly-git-worktree.ts`
- `src/handlers/gates/external-directory*.ts`, `bash-external-directory.ts`, `helpers.ts`
- `src/authority/forwarded-request-server.ts`, `forwarding-io.ts`, `permission-forwarding.ts` (portablePath)
- related tests under `test/worktree-runtime-context.test.ts`, external-directory*, authority*

### Tests (S1)

- `test/auto-mode-*.ts` (all golden / classifier / eval / request / observability)
- `test/config-*-auto-mode*.ts`, `test/extension-config-auto-mode.test.ts`
- `test/handlers/gates/runner-auto-mode.test.ts`
- `test/handlers/gates/tool.test.ts` (safety floor)
- `test/handlers/gates/readonly-git-worktree.test.ts`

## S2 — Two-stage (experimental; optional same branch, flag default off)

- `src/auto-mode-two-stage.ts`
- config keys under `autoMode.twoStage`
- tests that only cover two-stage

## S3 — Learning (exclude from release PR)

- `src/learning/**`
- `test/learning/**`
- `test/handlers/gates/runner-learned-grants.test.ts`
- `test/handlers/gates/runner-evidence-recorder.test.ts`
- `docs/plans/learned-capability-grants-prd.md`
- `docs/plans/skill-permission-inference-prd.md`

## Shared / unclear — review per diff hunk

- `src/expand-home.ts`, `extension-paths.ts`, `node-modules-discovery.ts`
- `src/path/**`, `wildcard-matcher.ts`, `session-rules.ts`
- `package.json` version — **do not ship 20.7.3**; rebase first
- monorepo root `biome.json`, `mise.toml` — only if required for S1 tasks; else drop from PR

## Out of package

- `packages/pi-subagents/**` — stashed; separate product
- `F:/code/pi/pi-auto-mode-classifier/**` — superseded MVP
