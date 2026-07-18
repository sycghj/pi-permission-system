---
issue: 597
issue_title: "pi-permission-system: serving resolves the forwarded access intent at gate parity"
---

# Retro: #597 — serving resolves the forwarded access intent at gate parity

## Stage: Planning (2026-07-18T18:40:00Z)

### Session summary

Planned Phase 12 Track A Step 3 — the serving node consumes the `ForwardedAccessIntent` Step 2 ([#596]) put on the wire, resolving the parent's recorded authority directly against the child-fixed `matchValues` (agent-scoped to `principal.agentName`) instead of re-deriving a path from a bare display string through the parent's `PathNormalizer`/cwd.
The plan is a three-step TDD sequence (additive resolver/`buildResolvedIntentFromMatchValues` infra `feat:` → the atomic serving-rework `feat:` → a `docs:` roadmap-completion step) filed at `packages/pi-permission-system/docs/plans/0597-serving-resolves-forwarded-intent.md`.
This step is the `cross-session-intent` batch tail, so it cuts the release shipping Steps 1–3.

### Observations

- **Issue body vs. ADR 0008 conflict surfaced via `ask_user`.**
  The issue body said "keep the legacy `(surface, value)` fallback for version skew," but ADR 0008 §4 explicitly retired that branch (rejected the "Tolerant dual-path" alternative) and floors a missing-intent request to `ask`.
  Operator confirmed: **follow ADR 0008** — retire the legacy branch, `ask`-floor on absence.
  Second `ask_user` decision: ship agent-scoped serving as **`feat:`** (non-breaking), per the [#557] serving-is-resolution precedent, not `feat!:`.
- **The resolver must accept a pre-fixed `path-values` intent.**
  Serving cannot go through the `access-path` variant (that would rebuild an `AccessPath` and re-derive — the exact flaw ADR 0008 removes).
  Resolution: widen the *concrete* `PermissionResolver.resolve` to `AccessIntent | PathValuesAccessIntent` (passthrough in `toResolvedIntent`'s else-branch), keeping the gate-facing `ScopedPermissionResolver` interface narrow.
  The forwarded-serving wire becomes a second legitimate producer of pre-fixed match values — coherent with ADR-0002 (strings in, manager never imports `AccessPath`).
- **Wire→intent mapping takes primitives, not `ForwardedAccessIntent`.**
  `buildResolvedIntentFromMatchValues(surface, matchValues, agentName)` lives in `input-normalizer.ts` (sibling of `buildAccessIntentForSurface`), so `access-intent/` stays decoupled from `authority/`.
- **`boundaryValue` is not needed for rule matching** — `matchValues()` already contains the canonical alias, so `evaluateAnyValue` matches a parent `/tmp/**` rule against the child's aliases directly; `boundaryValue`/`requesterCwd` ride for provenance/disclosure only.
- **Atomic Step 2 is unavoidable** — the `ServingPolicy` `check`→`resolve` rename cascades through the server, `index.ts`, `makeServerDeps`, and the `forwarded-request-server.test.ts` suite; folded into one `feat:` commit.
  The test rewrite is mechanical (mock rename + attach `accessIntent`), not a full large-file rewrite.
- **Dead-code gate respected** — the additive infra (Step 1) is exercised by its own new tests; `buildResolvedIntentFromMatchValues` is consumed by `index.ts` in Step 2, never landing unused.
- **Composition-root round-trip tests are the behavior-parity anchor** — they exercise the real serving path (real `ParentAuthorizer` stamps `accessIntent`, real server resolves), use `demo`/no-per-agent-rules so agent-scoped lands on the same `ask`, and stay green unchanged.
- **[#565] does not close here** — Step 3 structurally dissolves items 2–3, but [#565] stays open until Phase 12 end per roadmap decision.
- **Release**: ship now — `cross-session-intent` batch tail.
- Next stage is `/tdd-plan` (the plan has red→green→commit cycles).

### Diagnostic details

- **Feedback-loop gap analysis** — grounded every design claim in source before writing: read `forwarded-request-server.ts`, `permission-forwarding.ts`, `permission-resolver.ts`, `access-intent.ts`, `input-normalizer.ts`, `forwarding-io.ts`, `index.ts` (serving closure), the manager `check`, the full `forwarded-request-server.test.ts`, and the composition-root serving round-trip.
  Confirmed `asForwardedAccessIntent` already reconstructs `accessIntent` (Step 2), so no `forwarding-io.ts` change is needed.

## Stage: Implementation — TDD (2026-07-18T19:15:00Z)

### Session summary

Executed all three plan steps as planned, no Tidy-First preparatory refactors landed (the `tidy-first-assessor` found the target files already shaped for the change).
Four commits: additive `feat:` (resolver `path-values` acceptance + `buildResolvedIntentFromMatchValues`), the atomic `feat:` serving rework (`ServingPolicy` intent-shaped, legacy branch retired), a `docs:` roadmap-completion commit, and a small follow-up `docs:` commit fixing a stale doc comment the pre-completion reviewer flagged.
Test count 2491 → 2499 (+8).
Pre-completion reviewer returned WARN (one cosmetic finding), fixed before finishing.

### Observations

- **The Step-1 `permission-resolver.test.ts` red was hollow at the runtime level, real at the type level.**
  `toResolvedIntent`'s existing `else`-branch already returns any non-`access-path` intent unchanged, so a `path-values` object passed to `resolver.resolve` ran correctly through the *runtime* path before the type widening — the new test passed immediately under `vitest` (esbuild, no typecheck).
  The real red was `tsc`: `pnpm run check` failed with `TS2322` on the `path-values` literal until `PermissionResolver.resolve`/`toResolvedIntent` were widened to `AccessIntent | PathValuesAccessIntent`.
  Confirmed both reds explicitly (`vitest run` for the runtime file, `pnpm --filter ... run check` for the type-level file) before calling it Red, per the testing skill's "hollow red" warning.
- **Step 2 test rewrite was exactly as mechanical as planned.**
  Renamed every `policy: { check }` mock to `policy: { resolve }`, added `accessIntent` to the requests that needed to reach the resolve branch (via the new `makeForwardedAccessIntent` fixture), and split the single "floors a request without display fields" test into two: a fully-empty legacy request and a version-skew request that has `surface`/`value` but no `accessIntent` — the literal ADR 0008 §4 scenario, which the original single test didn't distinguish.
  No large-file rewrite needed a lift-and-shift; the whole file fit one atomic commit.
- **Composition-root round-trip anchors held unchanged, as predicted.**
  Both `forwarded grant-scope selection round-trip` tests (real `ParentAuthorizer` stamping `accessIntent`, real `ForwardedRequestServer` resolving it, `demo` surface with no per-agent rules) passed without any edit — confirming agent-scoped resolution is a true superset of the agent-neutral serving it replaced.
- **Pre-completion reviewer: WARN, one finding** — a stale doc comment on `ForwardedRequestServerDeps.policy` (`"Recorded-authority resolution for \`(surface, value)\` requests."`) that survived the `ServingPolicy` interface rename.
  Fixed in a trivial follow-up `docs:` commit (not amended into the feat commit, since the feat commit was already several commits back and AGENTS.md discourages non-interactive rebase for reordering).
  Reviewer explicitly verified the implementation matched the plan's two operator-confirmed deviations from the issue body (retire-outright over dual-path; `feat:` over `feat!:`) rather than flagging them as drift.
- **Reviewer note (non-issue):** the same pre-existing pi-autoformat acceptance-test flake noted in the #596 retro recurred (`pnpm run test` root pass, 2 RPC timeouts, unrelated package, standalone re-run green both before and after this session's changes).
- **Release**: ship now — `cross-session-intent` batch tail (Steps 1–3).
  Next step is `/ship-issue`.
