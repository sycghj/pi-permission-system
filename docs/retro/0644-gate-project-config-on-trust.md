---
issue: 644
issue_title: "pi-permission-system: project policy is loaded without checking project trust"
---

# Retro: #644 — pi-permission-system: project policy is loaded without checking project trust

## Stage: Planning (2026-06-13T00:00:00Z)

### Session summary

Planned the ADR-0001 implementation: gate project-scoped config loading on `ctx.isProjectTrusted()`.
This is a third-party issue (author `marcoscale98`), so the `ask_user` direction gate was mandatory; the operator confirmed implementing the ADR direction, covering **both** untrusted load paths, and **loudly warning** the user on skip.
Produced a 3-cycle TDD plan (`docs/plans/0644-gate-project-config-on-trust.md`) and committed it.

### Observations

- Source review surfaced a hole the issue and ADR-0001 did **not** name: untrusted project config leaks through **two** independent cwd-keyed paths, not one.
  The ADR only covers the permission **policy** (`PermissionManager.configureForCwd`); the extension **runtime config** path (`ConfigStore.refresh` → `loadAndMergeConfigs`) also merges the project's `config.json`, including `yoloMode: true` — arguably the worse hole.
  Operator chose to gate both.
- Design reuses existing levers where possible: passing `undefined` cwd to `configureForCwd` already yields global-only policy (via `derivePolicyLoaderOptions`), so the policy path needs no new manager code.
  The runtime path needs an **explicit** `includeProjectScope` flag, not an empty cwd — `getProjectConfigPath("")` resolves relative to `process.cwd()`, which would defeat the gate.
- Chose a **required** (no-default) `projectTrusted` parameter at every internal seam so TypeScript forces a conscious trust decision — no unsafe "trusted by default" fallback.
  The signature cascade (config-store → session → handler → index.ts) is compile-coupled, so the gate + all consumer/test updates land in one commit (cycle 2), per the lift-and-shift rule.
- Verified `ctx.isProjectTrusted()` exists on `ExtensionContext` in `@earendil-works/pi-coding-agent@0.79.1`. `resources_discover` handlers do receive `(event, ctx)`; `index.ts` currently drops the ctx arg — cycle 2 wires it.
- `#646` fail-closed clamp does not interact: an untrusted project's config is never loaded, so `projectConfig.invalid` never fires.
  No regression.
- Breaking change (`fix!`) → next major (package.json already at 21.0.0, release-please manifest ahead).
  Not in any roadmap batch → ship independently.
- Deferred (Open Questions, no follow-up filed): reload path re-reading runtime config on trust grant (safe interim = global-only runtime); surfacing trust state in `/permission-system` UI.

## Stage: Implementation — TDD (2026-07-24T18:00:00Z)

### Session summary

Implemented the trust gate across three TDD cycles plus one tidy-first prep commit: (1) `loadAndMergeConfigs` gained an `includeProjectScope` option; (2) the required `projectTrusted` boolean cascade through `ConfigStore.refresh` / `PermissionSession.{refreshConfig,resetForNewSession,reload}` / the two lifecycle handlers / `index.ts`, plus the loud warn + `project_trust.skipped` review-log entry; (3) docs (ADR-0001 status, `configuration.md`, `README.md`, new migration note).
Test count went from 2555 to 2570 (+15); all green, `check`/`lint`/`fallow` clean.

### Observations

- **Plan miss caught by `tsc`** — the plan's Module-Level Changes did not enumerate two additional project-config load sites: `before_agent_start` also calls `refreshConfig` (a mid-session runtime-config reload that would have re-leaked an untrusted project's `yoloMode` right before agent start), and the factory-init `configStore.refresh()` in `index.ts`.
  The required-parameter cascade made `tsc` surface both immediately.
  Both are now gated (`before_agent_start` on `ctx.isProjectTrusted()`, no re-warn; factory-init withholds the project scope with `(undefined, false)` since no trust decision exists yet).
  Grepped every `refresh`/`configureForCwd` call site to confirm no ungated path remains.
  Deviation documented in the `fix!` commit body.
- **Tidy-first paid off** — the assessor's one recommendation (extract `makeBaseCtx` in `composition-root.test.ts`) turned a five-place `isProjectTrusted` edit into one.
  Two more hand-built ctx objects outside that file (`session-start.test.ts`, `permission-events.test.ts`) still needed the field; the latter only surfaced at full-suite runtime (`ctx.isProjectTrusted is not a function`), not `tsc` — a reminder that hand-rolled ctx literals dodge the type check.
- **End-to-end proof** — the composition-root pair (untrusted project `bash: allow` does NOT override global `bash: deny`; trusted DOES) exercises the whole gate through the real service, the strongest evidence the fix holds.
- **`extractedProject` empty on skip** — `loadAndMergeConfigs` returns `project: {}` when the scope is withheld, so `MergedConfigResult.project` stays honest for downstream readers.
- **Pre-completion reviewer: PASS** (one non-blocking WARN, now fixed).

### Reviewer warnings

- WARN (fixed): the `README.md` "Upgrading" heading read `21.0.0`, but 21.0.0 already released (#646); relabeled to `22.0.0` (next major) and updated the in-page anchor.
  Amended into the docs commit before ship.
