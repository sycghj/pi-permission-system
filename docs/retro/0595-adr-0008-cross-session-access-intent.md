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

## Stage: Planning revision (2026-07-18T00:47:18Z)

### Session summary

The operator raised a meta-level doubt — whether the decisions felt hard due to a comprehension gap or a missing reframe — and an advisory dialogue surfaced the unifying principle: **the child owns the facts; the parent owns the judgment**.
The plan was amended (commit `88d2c886`) to restructure the ADR principle-first, add a composition section, and name two explicitly deferred edges.

### Observations

- **The reframe was real, not over-application.**
  The principle retro-explains decisions made independently — ADR 0005's serving-is-resolution (judgment repeats at each node) and ADR 0007's chain (plurality of judges within a node) — and derives all three previously confirmed parameters (child-fixed match set = facts at origin; agent-scoped serving = parent's judgment; `ask` floor = no facts → no judgment → escalate).
  Three independent confirmations distinguished a genuine reframe from a concept stretched too far.
- **The unified model** (validated against `authorizer.ts` / `authorizer-selection.ts`): authorization is a walk up a session tree; at each node an ordered sequence of judges (recorded authority → Track B chain links → terminal) examines the same fixed facts; the only inter-node operation is the courier move (`ParentAuthorizer`), which carries facts and never judgment.
  Key clarification for the operator's mental model: `ask` is *recorded authority's* non-definitive outcome, not an Authorizer's — today each session selects exactly one Authorizer, and every Authorizer answers definitively; the "set of Authorizers that may defer" is the Track B future (ADR 0007), which the operator's intuition anticipated.
- **`ParentAuthorizer` is a courier, not a judge** — it occupies the `Authorizer` slot structurally but exercises no judgment; this explains *why* ADR 0005 made serving re-run resolution.
- **Synergy consequence recorded**: once Tracks A and B both land, a serving node's chain links (e.g. the model judge) review forwarded asks against the child-fixed fact set — honest evidence, not a parent-side re-derivation.
- **Two guards against over-application baked into the plan**: the composition section is descriptive-only (cites `docs/decisions/0007-model-judge-authorizer-chain-adr.md` by path, decides nothing new), and the deferred-edges section names where the model is known-incomplete (single-surface fact set — #565 item 3; multi-hop principal identity).
- **For the `/build-plan` stage**: the ADR's Decision section leads with the principle; the four former "decisions" are now consequences derived from it; the two deferred edges belong in `## Consequences`, not silently omitted.
