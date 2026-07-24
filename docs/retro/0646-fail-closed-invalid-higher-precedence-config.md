---
issue: 646
issue_title: "pi-permission-system: invalid higher-precedence config inherits lower-scope allow rules"
---

# Retro: #646 — pi-permission-system: invalid higher-precedence config inherits lower-scope allow rules

## Stage: Planning (2025-06-12T00:00:00Z)

### Session summary

Planned the fix for the cross-scope fail-open: an invalid higher-precedence scope (project / agent / project-agent) becomes an empty scope, so `mergeScopesWithOrigins` inherits the lower scope's rules unchanged and a global `allow` survives a higher scope meant to `deny`/`ask` it.
The issue is third-party (author `marcoscale98`), so the `ask_user` gate confirmed direction and design: an always-on `allow`→`ask` flooring overlay, triggered by non-global scopes only, shipped as a breaking `fix!:`.
Wrote a 4-step TDD plan (`0646-...`) and committed it.

### Observations

- The `#547` strict-validation "fail-closed" is only correct for a **single** scope in isolation — an invalid scope's *missing* surfaces fall to universal `ask`, but a lower scope's **explicit** `allow` still wins.
  So #646 is a real, unfixed gap, and the `strict-config-validation.md` migration doc's "falls back to ask — never allow" line is misleading for the cross-scope case (flagged for a doc update).
- Clean symmetry hook: `rewriteAsksToYolo` (ask→allow, `origin: "yolo"`) is the exact mirror of the planned `floorAllowsToAsk` (allow→ask, `origin: "fail-closed"`).
  `deriveSource` keys on `rule.layer` + tool kind, not `origin`, so adding a `"fail-closed"` `RuleOrigin` does not ripple into source derivation — only `rule.ts` and the `architecture.md` inline `RuleOrigin` copy need touching.
- The invalid-scope signal is carried by a new optional `ScopeConfig.invalid` field; the loader is the single decision point.
  For agent scopes, `getFileStamp === "missing"` distinguishes an absent file (not invalid) from a present-but-unreadable one (invalid) — important so a missing agent file is not mis-clamped.
- Apply the overlay at **composition** (`resolvePermissions`), not at `check()`, so `getToolPermission` / `getComposedConfigRules` reflect the clamp; a floored `allow`→`ask` keeps the tool **visible** rather than silently allowed.
- yolo neutralizes the clamp (floored `ask` → `allow` at check time).
  This is intentional (yolo is an explicit full-permissive opt-in) and pinned with an invariant test rather than left implicit.
- Rejected the harder "refuse to activate / universal deny" option and the opt-out config knob per the operator's `ask_user` answers — proportionate `ask`, always-on.
