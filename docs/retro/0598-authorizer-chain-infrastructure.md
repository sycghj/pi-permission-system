---
issue: 598
issue_title: "pi-permission-system: Authorizer chain infrastructure (allow/deny/defer verdicts)"
---

# Retro: #598 — Authorizer chain infrastructure (allow/deny/defer verdicts)

## Stage: Planning (2026-07-18T00:00:00Z)

### Session summary

Planned Phase 12 Step 4 (Track B, batch "authorizer-chain" head): reshape the live-authority layer into a Chain of Responsibility per ADR 0007, with zero registered links so behavior is identical to today.
Produced `docs/plans/0598-authorizer-chain-infrastructure.md` with three commits — an atomic interface reshape + `composeAuthorizerChain`, a wiring step routing `AuthorizerSelection.activate` through the empty chain, and a doc-completion step.

### Observations

- **Terminal return type is the key reconciliation.**
  ADR 0007 sketches a minimal `TerminalVerdict` (`allow | deny` kind union), but the real terminals return the rich `PermissionPromptDecision` (session-scope states, `confirmationUnavailable`, `denialReason`).
  The "behavior identical" constraint forces keeping `PermissionPromptDecision` as the terminal's return; the ADR sketch is illustrative ("the essentials follow").
  Recorded as a Non-Goal so Step 5 doesn't re-litigate it.
- **Naming decision surfaced via `ask_user`.**
  The ADR reassigns the name `Authorizer` to the non-terminal link and introduces `TerminalAuthorizer` for the terminal, but today `Authorizer` **is** the terminal interface (3 concrete classes implement it).
  Operator chose the ADR-faithful rename over an additive `AuthorizerLink`, so Steps 5/6 inherit ADR vocabulary directly.
- **Empty-links identity is a behavioral invariant, not an optimization.**
  `composeAuthorizerChain([], terminal)` must return the terminal **instance** so `authorizer-selection.test.ts`'s `expect.any(LocalUserAuthorizer)` still holds.
  Called out in Design Overview + Invariants at risk.
- **`PermissionQuery` deferred to Step 5.**
  ADR 0007 §3 ties the injected query to the registration seam; a Step-4 link signature takes only `PromptPermissionDetails`.
  Step 5 will widen the link `authorize` signature — noted as an Open Question so it's not read as an oversight.
- **Release: mid-batch defer.**
  Step 4 is the batch "authorizer-chain" head (tail = Step 5, [#599]); the `docs:` step-completion commit lands in the pending release-please PR but must not be merged until Step 5 ships.
  `refactor:`/`test:` commits are `hidden:` and don't cut a release.
- **No follow-up issues filed** — Steps 5 (#599) and 6 (#600) already exist in the roadmap.

[#599]: https://github.com/gotgenes/pi-packages/issues/599
