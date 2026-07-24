---
issue: 645
issue_title: "pi-permission-system: Bash path gates miss bare symlink operands and paths embedded in flags"
---

# Retro: #645 — Bash path gates miss bare symlink operands and paths embedded in flags

## Stage: Planning (2026-07-24T21:04:26Z)

### Session summary

Verified both reported bypasses by tracing tokens through `token-classification.ts` / `bash-path-resolver.ts`: a bare in-project symlink (`cat outside-link`) never reaches canonicalization because [#509] promotion matches only the raw token against specific non-`*` `path` rules, and a `--file=/tmp/x` value is dropped by the leading-`-` prelude.
This is a third-party issue (author `marcoscale98`), so direction was confirmed across three `ask_user` rounds; the operator's meta-question ("what architecture change would make this class of problem easier?") reframed the plan from a targeted patch into a structural redesign.
Plan committed as `docs/plans/0645-bash-bare-token-flag-path-gates.md`.

### Observations

- **Chosen design — existence probe**: token classification is three-valued (definitely-path / definitely-not / unknown); "unknown" bare tokens are resolved by `lstat` (`PathNormalizer.entryExists`) instead of by consulting the ruleset.
  Candidacy from the filesystem, decision from explicit rules or the external boundary — never the universal fallback.
  This deletes the entire [#509] matcher thread (`PathRuleTokenMatcher`, `getPromotablePathTokenMatcher`, five-layer threading) rather than generalizing it.
- **Key discovery**: `describeBashPathGate` already implements the needed decision discipline — the `matchedPattern === undefined` guard (issue #58 in prose) treats universal-default-only matches as unrestricted, and `permission-manager.ts` sets `matchedPattern` only for `config`/`session` layers.
  Promoted tokens therefore need no new flag or manager consult.
- **Decision path across `ask_user` rounds**: round 1 chose bare-symlink-first with "full read-tool parity"; round 2 surfaced that literal parity + default-ask universal would prompt on every bare word, and the operator narrowed to rule-scoped gating; round 3 (after the reframing analysis) switched to the existence probe, added the ADR (0009, completeness contract), folded the flag-value case back in (it is token *preprocessing*, not classification — `--opt=value` split at collection), and required a performance spike using review-log commands before implementation.
- **No follow-up issues filed**: everything (both cases, ADR, spike) folded into #645 per the operator's "make the change easy" note.
- **Breaking**: two `fix(pi-permission-system)!:` commits planned (bare-token gating; flag-value gating), each with its own `BREAKING CHANGE:` footer; remediation via existing `path`/`external_directory` allow patterns was verified against the config surface.
- **Risk noted for implementation**: steps 5–6 are deliberately split (behavior change with the old thread present-but-ignored, then a pure type-level deletion) to bound test churn; the `#509` program-test promotion block migrates to tmpdir-symlink fixtures in step 5.
- **Spike gate**: p95 added cost < 1 ms/command; contingency (config-gated probe) named in the plan if it fails.

[#509]: https://github.com/gotgenes/pi-packages/issues/509
