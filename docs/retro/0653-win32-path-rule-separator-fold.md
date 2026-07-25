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

[#533]: https://github.com/gotgenes/pi-packages/issues/533
[#655]: https://github.com/gotgenes/pi-packages/issues/655
