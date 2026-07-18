---
issue: 596
issue_title: "pi-permission-system: carry the structured access intent onto the forwarded-permission wire"
---

# Retro: #596 — carry the structured access intent onto the forwarded-permission wire

## Stage: Planning (2026-07-18T15:25:00Z)

### Session summary

Planned Phase 12 Track A Step 2 — thread the child-fixed access facts from the raising gate through the escalation edge and onto the forwarded wire as the `ForwardedAccessIntent` field ADR 0008 (Step 1) specified.
The plan is a `feat:` sequence of six small cycles (wire type + tolerant read; edge serialization; four gate-emission steps) plus a `docs:` completion step, filed at `packages/pi-permission-system/docs/plans/0596-structured-intent-forwarded-wire.md`.
Skipped the `ask_user` gate: the issue is the operator's own and its proposed change is fully constrained by the already-accepted ADR 0008.

### Observations

- **Fact / identity split drove the design.**
  ADR 0008 groups a forwarded ask into *what is accessed* (fixed at the child gate) and *who/where requests* (a requester-session property).
  The plan mirrors that: the **gate emits** `{ surface, matchValues, boundaryValue }` (only it can produce the match set off the `AccessPath`), and the **escalation edge (`ParentAuthorizer`) stamps** `requesterCwd` + `principal`.
  This avoids threading cwd into every gate and localizes principal-stamping to the one layer that owns session identity.
- **`ForwarderContext` gains `cwd`** (from `ExtensionContext.cwd`, already present) so `ParentAuthorizer` sources `requesterCwd` at the edge — the one shared-interface tightening.
  Its fixture blast radius is contained by the central `makeForwarderContext` factory (`test/helpers/forwarding-fixtures.ts`); inline `ForwarderContext` fakes must add `cwd` in the same commit (the AGENTS.md tightened-shared-type fixture-grep rule).
- **No `GateDescriptor` change needed.**
  `GateDescriptor.promptDetails` is `Omit<PromptPermissionDetails, "requestId">`, and the runner spreads `promptDetails` into `escalate(...)`, so adding `accessIntent?` to `PromptPermissionDetails` makes it ride through every descriptor automatically — the facts land on `promptDetails`, satisfying the issue's "onto the descriptor/details" target without a structural edit to `descriptor.ts`.
- **ADR-0002 string boundary held explicitly.**
  Each gate converts its `AccessPath` to strings (`matchValues()`/`boundaryValue()`) at emit; the wire carries `string[]`, never an `AccessPath`.
  A Step-1 test asserts the serialized shape is strings only; the existing `permission-manager.ts` import lint is untouched.
- **Tolerant-read touch point** ([#558]) — `readForwardedPermissionRequest` reconstructs an allowlist, so the new field is silently dropped unless `asForwardedAccessIntent` is wired in; that extension is the first cycle and is round-trip tested (well-formed / malformed / absent).
- **Scope fence against Step 3** ([#597]) — serving still re-derives from display strings; `forwarded-request-server.ts`, `index.ts`'s `servingPolicy`, the `hasDisplayFields` floor, and agent-scoped resolution are all Non-Goals.
  The serving-read metric stays 0; only the forwarded-wire metric moves to ≥ 1.
- **Non-breaking** — an additive optional field with a tolerant read; no config/schema/default/observable-decision change.
  Commits are `feat:`/`test:`/`docs:`, none breaking.
- **Release**: mid-batch — defer (batch "cross-session-intent", tail = Step 3 / #597).
  Step 2 is not the batch tail, so it cuts no release on its own.
- **No follow-up issues filed** — Step 3 (#597) already exists; ADR 0008 records the two deferred edges (single-surface fact set, multi-hop principal identity).
  One resolved-in-plan design choice: `principal` nests a self-contained copy rather than reusing the top-level `requesterSessionId`/`requesterAgentName`, because Step 3 reads `intent.principal.agentName` and a self-contained fact object is cleaner.
- Next stage is `/tdd-plan` (the plan has red→green→commit cycles).

### Diagnostic details

- **Feedback-loop gap analysis** — grounded every design claim in source before writing: read all target files (`permission-forwarding.ts`, `forwarding-io.ts`, `approval-escalator.ts`, `permission-prompter.ts`, the six gate factories, `forwarder-context.ts`, `access-path.ts`) and confirmed `ForwarderContext` lacks `cwd` while `ExtensionContext.cwd` exists (`permission-gate-handler.ts:73`), which is what made the edge-sourced `requesterCwd` viable.
