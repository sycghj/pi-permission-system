---
issue: 51
issue_title: "Generalize session approvals to all permission surfaces with wildcard patterns"
---

# Generalize session approvals to all permission surfaces

## Problem Statement

Session-scoped approvals (#45, #57) currently work only for `external_directory`.
When working in a session, the user is still prompted repeatedly for the same class of bash command, MCP tool, or skill load.
There is no way to say "yes, allow `git status*` for the rest of this session" without changing the on-disk policy to `allow`.

OpenCode solves this with a general-purpose "always" approval that works across all permission surfaces using wildcard pattern matching and per-surface pattern suggestions.

## Goals

- Generalize session approvals to all permission surfaces: bash, tools, mcp, skills, special, external_directory.
- Each surface **suggests approval patterns** when prompting (e.g., bash suggests `git status*`, MCP suggests `exa:*`).
- Show the suggested pattern in the dialog text so the user sees what they're approving.
- Use `evaluate()` with the composed ruleset (config + session) as the sole decision path — no separate pre-checks.
- Record `resolution: "session_approved"` with the matched pattern in the review log.
- Re-evaluate pending/future permission checks naturally via the session layer (no explicit re-evaluation needed — Pi tool calls are sequential).

## Non-Goals

- Bash arity table for smart pattern suggestions (#52 — follow-up; initial bash suggestion uses a simpler heuristic).
- `~`/`$HOME` expansion in patterns (#53 — follow-up).
- Flat `permission: { ... }` config format (#66 — orthogonal).
- Persisting session approvals to disk ("Always" option — future work).
- Per-agent scoping of session approvals (use the same session layer regardless of active agent).
- Synthesizing defaults into the ruleset (#65 — prerequisite, must land first).

## Dependencies

This issue is **blocked on #65** (synthesize defaults into ruleset + unify the evaluate path).

Without #65:

- `checkPermission()` doesn't see session rules — each surface needs a separate pre-check.
- The external_directory pre-check in `tool-call.ts` is a one-off pattern that would need to be duplicated 4×.
- Fallback defaults (`bashDefault`, `mcpToolLevel`) live outside the ruleset and complicate the flow.

With #65 landed:

- Session rules are part of the composed array passed to `evaluate()`.
- The external_directory pre-check dissolves — `evaluate()` handles it.
- Adding session approvals to new surfaces is: suggest a pattern → on "for session" → `sessionRules.approve(surface, pattern)` → done.

## Background

### Relevant modules (after #65 lands)

|File|Role|
|---|---|
|`src/rule.ts`|`Rule`, `Ruleset`, `evaluate()` — the sole decision engine|
|`src/session-rules.ts`|`SessionRules` class (Ruleset wrapper) + `deriveApprovalPattern()`|
|`src/permission-gate.ts`|`applyPermissionGate()` — deny/ask/allow branching with prompt injection|
|`src/permission-dialog.ts`|Dialog options: Yes / Yes for session / No / No with reason|
|`src/permission-prompts.ts`|User-facing message formatting per surface|
|`src/handlers/tool-call.ts`|Consumes gates for all surfaces; currently has separate session pre-check for external_directory|
|`src/wildcard-matcher.ts`|`wildcardMatch()` used by `evaluate()`|

### Permission surfaces involved

All: `bash`, `mcp`, `skill`, `read`/`write`/`edit`/etc. (tools), `external_directory`.

### Current flow (external_directory only)

1. Check session rules separately (pre-gate) via `evaluate("external_directory", path, sessionRuleset)`.
2. If session hit → log `session_approved`, skip gate.
3. If miss → run gate → if `approved_for_session` → `sessionRules.approve()`.

### Target flow (all surfaces, after #65)

1. Compose rules: `[...defaults, ...configRules, ...sessionRules]`.
2. Call `evaluate(surface, value, composedRules)`.
3. If result is `allow` or `deny` → done (session hit is just another `allow`).
4. If result is `ask` → prompt with pattern suggestion → on "for session" → `sessionRules.approve(surface, pattern)`.

The separate pre-check disappears. Session approvals are just rules that win (last in array = highest priority).

## Design Overview

### Extending `PermissionGateResult`

The gate needs to communicate back "this was approved for session" so the caller can record the rule.
We extend the result type:

```typescript
export type PermissionGateResult =
  | { action: "allow"; sessionApproval?: { surface: string; pattern: string } }
  | { action: "block"; reason: string };
```

And add a `sessionPatterns` field to `PermissionGateParams`:

```typescript
export interface PermissionGateParams {
  // ... existing fields ...
  /** Suggested pattern for "approve for session". When provided, the gate attaches it to the result on session approval. */
  sessionApproval?: { surface: string; pattern: string };
}
```

The gate inspects `decision.state === "approved_for_session"` internally and attaches the suggested pattern to the result.
The caller records it into `SessionRules`.
No closure capture needed.

### Pattern suggestion function

```typescript
// src/pattern-suggest.ts
export function suggestSessionPattern(
  surface: string,
  value: string,
  input?: unknown,
): { surface: string; pattern: string } {
  switch (surface) {
    case "bash":
      return { surface: "bash", pattern: suggestBashPattern(value) };
    case "mcp":
      return { surface: "mcp", pattern: suggestMcpPattern(value, input) };
    case "skill":
      return { surface: "skill", pattern: value }; // exact skill name
    case "external_directory":
      return { surface: "external_directory", pattern: deriveApprovalPattern(value) };
    default:
      // Tool surfaces (read, write, edit, etc.) — approve all uses of this tool
      return { surface, pattern: "*" };
  }
}
```

#### Bash pattern suggestion (initial heuristic, pre-#52)

Without the arity table (#52), use a simple heuristic:

- Split on first space to get the base command.
- Suggest `<base-command> *` (e.g., `git *`, `npm *`, `cat *`).
- For single-word commands (no arguments), suggest the exact command.

This is intentionally conservative — over-broad bash patterns are a security risk.
The arity table (#52) will refine this later (e.g., `git checkout *` instead of `git *`).

#### MCP pattern suggestion

- If the resolved target contains `:` (qualified), suggest `<server>:*` (server-level).
- If the resolved target contains `_` (munged), suggest `<server>_*` (server-level).
- Fallback: exact target.

#### Dialog text

The pattern is shown in the session option:

```text
Agent 'default' requested bash command 'git status --short'. Allow this command?
  ● Yes
  ● Yes, allow "git *" for this session
  ● No
  ● No, provide reason
```

### Review log changes

When session approval is used (future check hits a session rule):

```jsonc
{
  "event": "permission_request.session_approved",
  "resolution": "session_approved",
  "surface": "bash",
  "value": "git status --short",
  "sessionApprovalPattern": "git *"
}
```

When the user selects "for session":

```jsonc
{
  "event": "permission_request.approved",
  "resolution": "approved_for_session",
  "sessionApprovalPattern": "git *"
}
```

### Identifying session-approved results

After #65, session rules are part of the composed ruleset.
The caller needs to distinguish "allowed by config" from "allowed by session rule."

Approach: `evaluate()` returns the matching `Rule` by reference.
The caller checks membership: `sessionRules.getRuleset().includes(matchedRule)`.
If true, it's a session-approved hit — log `session_approved` and skip the gate entirely.

Alternatively, `SessionRules` can tag its rules with a provenance marker (a symbol or a `source` field).
The simpler membership check is sufficient for now.

## Module-Level Changes

### `src/pattern-suggest.ts` (new)

- `suggestSessionPattern(surface, value, input?)` — returns `{ surface, pattern }`.
- `suggestBashPattern(command)` — simple first-word heuristic.
- `suggestMcpPattern(target, input?)` — server-level wildcard.
- Exports pure functions, no IO.

### `src/permission-gate.ts` (modified)

- Add `sessionApproval?: { surface: string; pattern: string }` to `PermissionGateParams`.
- Extend `PermissionGateResult` allow variant with optional `sessionApproval`.
- Gate attaches `sessionApproval` to result when `decision.state === "approved_for_session"`.

### `src/permission-prompts.ts` (modified)

- Update `formatAskPrompt()` (and similar) to accept and display the suggested session pattern in the dialog text.
- New helper: `formatSessionOptionLabel(pattern)` → `"Yes, allow \"<pattern>\" for this session"`.

### `src/permission-dialog.ts` (modified)

- Update `APPROVE_FOR_SESSION_OPTION` to be dynamically generated with the pattern (or keep static and let the prompt message carry the detail).

### `src/handlers/tool-call.ts` (modified)

- Remove the separate session-rule pre-check for external_directory (handled by unified evaluate after #65).
- At each gate call site, compute `suggestSessionPattern()` and pass it via `sessionApproval` param.
- After gate returns, if `result.sessionApproval` exists, call `sessionRules.approve(...)`.
- Handle session-hit detection: when `evaluate()` returns a rule that's in the session layer, log `session_approved` and skip the gate.

### `src/session-rules.ts` (minor modification)

- Possibly add a `has(rule: Rule): boolean` method for membership checking.
- `deriveApprovalPattern()` stays (used by `suggestSessionPattern` for external_directory).

### `tests/pattern-suggest.test.ts` (new)

- Unit tests for `suggestSessionPattern` across all surfaces.
- Edge cases: empty command, multi-word commands, MCP qualified vs. munged names.

### `tests/permission-gate.test.ts` (modified)

- Test that `sessionApproval` is attached to result when `approved_for_session` and `sessionApproval` param is provided.
- Test that it's absent when `approved` (once) or `denied`.

### `tests/handlers/tool-call.test.ts` (modified)

- Test session-hit detection: session rule in composed ruleset → skip gate, log `session_approved`.
- Test session recording: user picks "for session" → `sessionRules.approve()` called with suggested pattern.
- Test per-surface: bash, mcp, skill, tool, external_directory.

## TDD Order

1. **test: add pattern suggestion unit tests for all surfaces**
   - Red: tests for `suggestBashPattern`, `suggestMcpPattern`, `suggestSessionPattern`.
   - Green: implement `src/pattern-suggest.ts`.
   - Commit: `test: cover suggestSessionPattern for all surfaces`

2. **feat: implement pattern suggestion module**
   - Commit: `feat: add pattern-suggest module for session approval patterns`

3. **test: gate returns sessionApproval on approved_for_session**
   - Red: test that gate attaches `sessionApproval` from params when `decision.state === "approved_for_session"`.
   - Green: extend `PermissionGateParams` and `PermissionGateResult`.
   - Commit: `test: cover gate sessionApproval pass-through`

4. **feat: extend permission gate with sessionApproval**
   - Commit: `feat: extend PermissionGateResult with sessionApproval field`

5. **test: session-hit detection skips gate for all surfaces**
   - Red: test that when `evaluate()` returns a session-layer rule, the handler logs `session_approved` and doesn't prompt.
   - Green: implement session-hit check in tool-call handler.
   - Commit: `test: cover session-hit detection across surfaces`

6. **feat: wire session approvals into all gate call sites**
   - Compute `suggestSessionPattern()` at each gate call site.
   - Pass via `sessionApproval` param.
   - Record into `SessionRules` when result carries `sessionApproval`.
   - Remove external_directory-specific pre-check (replaced by unified flow).
   - Commit: `feat: generalize session approvals to all permission surfaces (#51)`

7. **test: dialog text shows suggested pattern**
   - Red: test that prompt message includes the session pattern.
   - Green: update `formatAskPrompt()` or add `formatSessionOptionLabel()`.
   - Commit: `feat: show session approval pattern in dialog text`

8. **docs: update README and example config with session approval behavior**
   - Commit: `docs: document generalized session approvals (#51)`

## Risks and Mitigations

|Risk|Mitigation|
|---|---|
|Bash pattern suggestion too broad (`git *` allows `git push --force`)|Initial heuristic is deliberately simple (first word + `*`). The pattern is shown in the dialog so the user sees what they're approving. #52 refines with arity table.|
|MCP server-level pattern (`exa:*`) allows all tools on that server|Same mitigation — shown in dialog. Users can decline and get prompted individually.|
|Session rule shadows a config deny rule|Session rules are `allow`-only. A session allow for `git *` would override a config deny for `git push*`. This is intentional — the user explicitly said "yes for this session." The dialog text makes the scope visible.|
|Could this silently weaken a permission?|No — every session rule requires an explicit user approval via the dialog. The pattern is visible in the option text. No rule is added without user action.|
|Depends on #65 which may change the evaluate path|Plan is written against #65's target contract (session rules in composed array, unified evaluate). If #65's API differs, step 5–6 adjust accordingly.|
|Pattern suggestion for tools (`{ surface: "read", pattern: "*" }`) approves all reads|This matches the current behavior for external_directory (approves all access under a directory). For tools like `write` or `edit`, this is more powerful. Consider whether tool surfaces should suggest a path-based pattern instead — defer to follow-up if needed.|

## Open Questions

- Should "Yes, for session" for write/edit tools use a path-based pattern (e.g., `src/*`) rather than a blanket `*`?
  Leaning toward blanket `*` for now — if the tool is at `ask` level, the user has already decided that tool-level gating is appropriate.
  Path-specific session rules could be a follow-up refinement.
- Should the dialog dynamically change the "for session" option text to show the pattern?
  Yes — confirmed by design. The label becomes `"Yes, allow \"<pattern>\" for this session"`.
- Should we add a "Deny for session" option?
  Defer — deny is typically one-off (the user might change their mind). If demand emerges, add as a follow-up.
