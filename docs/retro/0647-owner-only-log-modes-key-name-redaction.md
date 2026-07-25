---
issue: 647
issue_title: "pi-permission-system: permission review logs may persist secrets with inherited file modes"
---

# Retro: #647 — pi-permission-system: permission review logs may persist secrets with inherited file modes

## Stage: Planning (2026-07-25T19:52:14Z)

### Session summary

Planned the response to a third-party security report from `marcoscale98` claiming the permission review log persists secrets with umask-inherited file modes.
The direction gate ran twice: an initial `ask_user` settled the file-mode half and the mode scope, and the operator deferred the redaction half to free-form discussion, which converged on key-name masking plus ADR 0010.
Produced `packages/pi-permission-system/docs/plans/0647-owner-only-log-modes-key-name-redaction.md` with six TDD cycles.

### Observations

- **Measuring the live corpus changed the design.**
  The operator's own review log (6.7 MB, 8380 lines, mode 0644) was probed for the shapes a value-based redactor would target.
  `sk-` had 403 hits, of which 356 were the tail of `task-approval` and 275 of `task-user`; `xox` matched inside a tool-use id.
  True positives: zero.
  That evidence, not an argument from principle, is what retired the provider-prefix list — and it belongs in the ADR so the next reporter is triaged against data.
- **A structural fact invalidated the obvious design.**
  The first instinct was a single redaction choke point at `writeLine` in `logging.ts`.
  Reading `permission-prompter.ts:135` showed `toolInputPreview` arrives there already flattened to a string by `serializeToolInputPreview`, so that choke point would have missed the reporter's literal repro (`authorization: "Bearer TEST_VALUE"` as a tool-input field).
  The plan therefore redacts at two points, and the reason is written down rather than left to be rediscovered.
- **Ecosystem precedent settled a question the operator flagged as outside their experience.**
  Pino's `redact`, Winston's formats, and Serilog's destructuring policies are all declarative key-path masking; secret *detection* is a separate product category (gitleaks, trufflehog).
  Naming that precedent turned "I have no experience engineering this" into a bounded, fifteen-line decision.
- **A downstream `registerLogRedactor` seam was considered and declined.**
  It would have mirrored the three existing registries exactly, so novelty was low — but it would ship with zero consumers, which the package skill's maintenance-trap rule explicitly targets, and the operator confirmed they would not consume it.
- **Grammar-anchored bash redaction was costed, not filed.**
  Masking the value side of a `variable_assignment` in the existing tree-sitter parse would extend coverage to `FOO_TOKEN=abc deploy` with near-zero false positives, reusing #481/#645 machinery.
  Recorded in the ADR as the option a future report reopens; deliberately not filed as an issue, to avoid a speculative backlog entry.
- **Two grep findings would have bitten implementation.**
  `test/tool-input-preview.test.ts` and `test/tool-preview-formatter.test.ts` mock `safeJsonStringify` by **relative** specifier (`../src/logging.js`), not the `#src/` alias — an alias-only grep misses both, and a missed retarget fails at run time rather than under `tsc`.
  Separately, `safeJsonStringify`'s cycle / `Error` / `bigint` handling has no test at all, so the step-1 move needs characterization tests written first.
- **Scope held.**
  `config-store.ts`'s config write was offered in the mode-scope gate and not selected; forwarding request/response files were.
  Those files get modes but not redaction, since the parent reads them to render the ask-prompt — the same reason the prompt path itself stays unredacted.
- Classified non-breaking (`fix:`): the review log is a diagnostic artifact with no documented consumer contract, and the docs never guaranteed verbatim payloads.
