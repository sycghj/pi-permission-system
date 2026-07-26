---
issue: 642
issue_title: "pi-permission-system: preserve Ctrl+O tool expansion in inline permission prompts"
pr: 643
---

# Retro: #642 — preserve Ctrl+O tool expansion in inline permission prompts

Tracking issue **#642** (the bug report); PR **#643** is @0xbentang's implementation against it, evaluated below as reference material.
Both were filed by @0xbentang.

## Stage: PR Review (2026-07-26T01:17:17Z)

### Session summary

Issue #642 reports that Pi's `app.tools.expand` action (Ctrl+O) has no effect while an inline permission prompt is focused; PR #643 from @0xbentang (third party) implements a fix, so a user can expand a truncated tool preview before approving it.
The underlying gap is real: `PermissionPromptComponent.handleInput` consumes every keystroke and the `ctx.ui.custom` factory discards its injected keybindings manager (`_keybindings`), so the global expand action is dead for the whole duration of an ask.
The operator chose **direction 1 — adopt the capability with our own simplified design**, using the PR as reference rather than the merge target.

### Evaluation

**Problem — real, and it works against a stated package priority.**
`packages/pi-permission-system/src/authority/permission-prompt-component.ts` renders the ask inline (`view.ui.custom(..., { overlay: false })`) and takes focus.
Its `handleInput` dispatches only to `handleReasonInput` and `toEvent`, and `presentInlinePermissionPrompt` names the third factory argument `_keybindings`, so no application action survives the prompt.
The package's "keep block/ask/allow decisions reviewable" priority argues directly for the fix: the moment a user most needs the full pending tool invocation is the moment they are deciding on it.

**The SDK surface exists and the sibling pattern is established.**
Verified against the sibling Pi checkout, not the bundled `dist`:

- `ExtensionUIContext.getToolsExpanded()` / `setToolsExpanded()` are declared at `../pi/packages/coding-agent/src/core/extensions/types.ts:277`.
- All three modes supply them — interactive (`interactive-mode.ts:2189`), RPC (`rpc-mode.ts:302`, no-op), and the headless runner stub (`runner.ts:262`) — so widening the prompt's UI surface cannot fail at runtime.
- `setToolsExpanded` already calls `this.ui.requestRender()` itself (`interactive-mode.ts:3815`), so the PR is correct **not** to add a redundant `requestRender()` after the toggle.
- Pi's own `ExtensionSelectorComponent.handleInput` performs the same `kb.matches(keyData, "app.tools.expand")` check first (`components/extension-selector.ts:93`), so this is convention-fit, not an invented shape.

There is no speculative generality here — nothing declared-but-unread, no over-wide threading of a value through layers that ignore it.
CI on the PR head is green (`check` passes).

**What is valuable:** the capability itself, the decision to route through the injected `KeybindingsManager` rather than hard-coding `\u000f`, the delegation of the `get`/`set` reach-through into a closure owned by `presentInlinePermissionPrompt`, and the regression test's core assertion — that toggling never settles the decision promise.

**What I would change:**

1. **Interface segregation on the SDK type.**
   The PR imports `KeybindingsManager` whole but uses only `.matches()`.
   The PR's own test is the tell: `PromptFactory` types the argument as `{ matches(data: string, action: string): boolean }` — the narrow contract already surfaced under test pressure and should be the production shape.
2. **Constructor width.**
   `PermissionPromptComponent` goes from six to eight positional constructor parameters, and two of the additions (`keybindings` + `toggleToolsExpanded`) are one collaborator's worth of behavior split across two slots.
   Collapse them into a single injected seam — an "app action consumed this keystroke" predicate of shape `(data: string) => boolean` — so `presentInlinePermissionPrompt` owns both the keybinding lookup and the `ui` reach-through, the component holds no Pi SDK type, and the test needs no fake keybindings manager.
   This is "thread decisions, not discriminators": the component should not re-interpret a raw keybindings manager.
3. **Key precedence during the `reason` step.**
   The PR checks the app action at the very top of `handleInput`, ahead of the `reason` branch.
   Harmless for the default Ctrl+O (`\u000f` is non-printable and `isPrintable` would drop it anyway), but `app.tools.expand` is user-rebindable: a printable rebinding becomes untypeable inside a deny reason and shadows the `y`/`s`/`n`/`r` decision hotkeys.
4. **Docs.**
   The inline-dialog key table in `docs/configuration.md` (the block at lines 119-130) says nothing about tool expansion, so the behavior is undocumented.

**Behavior / breaking:** not breaking.
Purely additive keystroke handling — no output shape, no default, no config field, no change to any existing key's meaning.
`fix(pi-permission-system):` is the correct type.

**Security surface:** least-privilege and aligned with the package's priorities.
The toggle mutates display expansion only; it cannot resolve, arm, or alter a pending decision, and the new test asserts non-resolution across two toggles before the decision is committed.
It strictly increases the information available to the human before an approval.

### Decision and attribution

**Direction: adopt the capability, plan a simplified design** (`/plan-issue #642`).
The work is tracked on issue **#642**; PR #643 is reference material, and the implementation is ours.

Agreed scope:

- Toggle `app.tools.expand` while the inline permission prompt is focused, without touching the pending decision.
- Collapse the two new constructor parameters into one narrow app-action seam; keep `KeybindingsManager` out of `PermissionPromptComponent`.
- **Precedence: check the app action before local handling, but only in the `decision` and `scope` steps** — the `reason` step's text entry is never intercepted.
  Operator's call, and I agree: it preserves Pi-like precedence while choosing, and removes the rebinding collision entirely for text input.
- Update the inline-dialog key table in `docs/configuration.md` and the prompt description in `README.md`.

Non-goals (operator decisions, both sound):

- **No expand hint in the prompt's hint line.**
  Expansion is a global app binding most users already know, the decision-step hint line is already dense, and a permission dialog is the wrong place to teach an unrelated global key.
- **The `PermissionPromptUi` widening stands as the PR has it.**
  It also types `LocalUserAuthorizerDeps.ui`, so the non-TUI `requestPermissionDecisionFromUi` path nominally gains two methods it never calls — accepted, since every mode supplies them and the alternative (a separate field on `PermissionPromptView`) buys little.
  This is why the diff touches `local-user-authorizer.test.ts`; expect the same test churn in our implementation.

Attribution — required on every implementation and docs commit for this work, as the last line of the body after a blank line:

```text
Co-authored-by: Ben Tang <bentang@fastmail.com>
```

Reference both as `Refs #642, #643` / `(#642)` — never `Closes #642` or `Closes #643`, which would pre-empt the curated close comments.

Close-out at ship time closes **both**:

- Issue **#642** — `issue_close` as `completed`, with the behavior summary and the implementing SHA(s).
- PR **#643** — closed as superseded, with a comment thanking **@0xbentang** by name, explaining that we adopted the capability with a simplified design, and linking the implementing SHA(s).
