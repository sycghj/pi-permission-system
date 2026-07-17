---
issue: 595
issue_title: "pi-permission-system: ADR 0008 — forwarded access-intent portability and principal identity"
---

# Retro: #595 — ADR 0008 forwarded access-intent portability and principal identity

## Stage: Planning (2026-07-17T23:56:20Z)

### Session summary

Planned Phase 12 Step 1 (Track A) — a docs-only ADR (`docs/decisions/0008-cross-session-access-intent.md`) that settles the cross-session access-intent contract before Steps 2–3 change the wire.
Because the deliverable is a decision, ran the `ask_user` gate over the three deliberative parameters and confirmed all three with the operator.
Wrote `packages/pi-permission-system/docs/plans/0595-adr-0008-cross-session-access-intent.md` and committed it.

### Observations

- **Three decisions confirmed with the operator** (two `ask_user` rounds — the first surfaced the parameters, the second tightened them after grounding in the code):
  1. **Agent-scoped serving** — `requesterAgentName` graduates from display-only to decision-participating; the parent resolves against its own ruleset scoped to the requester's agent name.
     Clarified the operator's double-apply worry: forwarding up means the child landed on `ask` (unresolved), and the parent applies a *different* ruleset — a strict superset of agent-neutral, no double-application.
  2. **Child-fixed match set** — ship `matchValues()` ∪ `boundaryValue()`; the parent never re-derives through its own `PathNormalizer`/cwd.
  3. **Required field, floor to `ask` on absence** — `ForwardedAccessIntent` is the sole resolution path (legacy `(surface, value)` branch retired in Step 3); a request missing it floors to `ask`, never a hard deny or silent grant.
- **Key grounding finding that resolved the operator's portability uncertainty**: `AccessPath.matchValues()` already carries a **cwd-relative alias** (via `getCwdRelativePathPolicyValues`), not just absolute + canonical.
  So the worktree scenario resolves correctly without re-derivation — a relative parent rule (`src/**`) matches the child's relative alias across cwds, while an absolute rule matches only co-located paths (least privilege).
  Canonicalization does *not* bridge cwds (git worktrees are real dirs, not symlinks); the relative alias is the bridge.
- **Revises ADR 0005** — the "agent-neutral resolution" section of `0005-serving-authorizer-provenance.md` is the exact decision being changed; the ADR must cross-link and state what 0005 behavior is preserved (recorded-authority-first, escalate-`ask`, provenance-on-the-ask).
- **ADR 0002 boundary** — the wire schema carries strings (`matchValues: string[]`), never `AccessPath` instances, keeping the manager string-based.
- **Release**: mid-batch — defer (batch "cross-session-intent", tail = Step 3 / #597).
  Both plan-execution commits are `docs:` (hidden), so this step cuts no release on its own.
- **No follow-up issues filed** — Steps 2 (#596) and 3 (#597) already exist as the implementation of this contract.
- Next stage is `/build-plan` (docs-only, no test cycles).
