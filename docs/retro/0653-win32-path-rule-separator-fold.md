---
issue: 653
issue_title: 'Windows: path rule "/dev/null": "allow" never matches due to wildcard separator normalization asymmetry'
---

# Retro: #653 — Windows: path rule "/dev/null": "allow" never matches due to wildcard separator normalization asymmetry

## Stage: Planning (2026-02-13T10:50:00Z)

### Session summary

Confirmed the reported bug end to end by spiking against the real pipeline rather than reasoning from the issue body: `BashProgram.parse("echo hi > /dev/null", win32Normalizer)` yields a `path` rule candidate whose only match value is `/dev/null`, and `PermissionManager.check` under `["*": ask, "/dev/null": allow]` answers `ask` because the rule compiled to `^\dev\null$`.
Applied the proposed fix as a throwaway spike and re-ran the full 2594-test suite green, then spiked the follow-on alias removal and confirmed only the two assertions that spell the alias out fail.
Wrote `docs/plans/0653-win32-path-rule-separator-fold.md` with four cycles (fix, compiled-pattern refactor, alias removal, docs) and filed [#655] for the adjacent `deriveApprovalPattern` design question.

### Observations

- The issue was third-party (`llllllllqq`), so the `ask-user` direction gate applied.
  The operator chose the symmetric fold in `wildcardMatch` over the narrower `AccessPath.forDevice` alias, and asked whether it generalizes enough to retire [#533]'s workaround — it does, verified by spike.
- The root cause generalizes past `/dev/null`: on win32 the `AccessPath` match-value union mixes separator conventions (`win32.resolve`/`win32.relative` aliases carry `\`, the as-typed literal, `forDevice`, and `forLiteral` carry `/`), so *every* forward-slash match value was unmatchable, not just the device.
  [#533] patched one shape of this with a hand-attached backslash match alias; treating the fold as an equivalence relation applied to both operands retires that workaround.
- Added a design step the issue did not propose: move matching onto the compiled pattern (`matches(value)`, drop the exposed `regex`) so the fold cannot be half-applied by a future caller.
  `findCompiledWildcardMatch` already calls `.regex.test(value)` — harmless today only because nothing compiles it with win32 options.
- Tracing the repro surfaced a documentation defect the issue did not mention: `docs/configuration.md` claims the safe device paths "never trigger the gate", but `isSafeSystemPath` exempts them from `external_directory` only — the cross-cutting `path` gate resolves them on both platforms.
  Surfaced via a second `ask_user`; the operator confirmed the behavior is right and the prose over-claims, so the plan corrects the doc and leaves the gate alone.
- Rejected alternative recorded in the plan: normalizing separators when *building* match values (in `AccessPath`).
  It scatters half the relation across three construction sites and misses `isPiInfrastructureRead`, which matches a configured glob against a boundary value rather than an alias union.
- Spiking before writing paid off twice: it killed a suspected `?`-after-separator regex quirk that turned out not to exist, and it converted the "Invariants at risk" table's riskiest row ([#533]'s `/tmp*` guarantee) from an argument into a measured result.

## Stage: Implementation — TDD (2026-02-13T11:05:00Z)

### Session summary

Landed all four planned cycles with no deviations: the symmetric `foldSeparators` fix, the `CompiledWildcardPattern.matches(value)` refactor that removes the raw-`RegExp` escape hatch, removal of the now-redundant [#533] backslash match alias (including the `matchAliases` parameter on `AccessPath.forLiteral` / `PathNormalizer.forLiteral`), and the doc pass.
Test count in `pi-permission-system` went 2593 → 2603; `pnpm run check`, root `pnpm run lint`, `pnpm run test`, and `pnpm fallow dead-code` are all green.
Pre-completion reviewer returned PASS.

### Observations

- The `tidy-first-assessor` recommended nothing and rejected five candidates with specific reasons (notably: the plan's own `foldSeparators` extraction *is* the feature commit, not a preparation for it).
  Its scope boundary held — nothing it considered lay outside the target files.
- Every red was honest and every green landed first try, because the planning session had already spiked the fix and the alias removal against the real suite.
  The only surprise was zero surprises: the spiked prediction (full suite green after the fix; exactly two alias assertions failing after the removal) matched the actual run exactly.
- Added negative controls the plan did not name — `wildcardMatch("/dev/null", "/dev/stdout", { windowsSeparators: true })` is `false`, and the fold stays off by default — so the widening is pinned as separator-only rather than merely asserted in prose.
  For a permission surface that felt worth the two extra assertions.
- Cycle 2's red was a runtime `TypeError` rather than a type error, since Vitest's esbuild does not typecheck; `pnpm run check` after the green was what actually proved the removed `regex` field had no surviving reader.
- One `Edit` call carried stray `oldText2`/`newText2` keys (the failure mode `AGENTS.md` warns about — silently ignored while still reporting success).
  Both intended blocks were separate `edits[]` entries so nothing was dropped, but the reported-blocks-vs-intended-edits count is what caught it.
- Reviewer verdict: PASS, no warnings.
  It independently confirmed the [#533] invariant test still pins its guarantee and that the fold cannot become a bypass (it widens `allow`, `deny`, and `ask` identically, win32-only).

[#533]: https://github.com/gotgenes/pi-packages/issues/533
[#655]: https://github.com/gotgenes/pi-packages/issues/655
