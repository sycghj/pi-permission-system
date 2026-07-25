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

## Stage: Implementation — TDD (2026-07-25T20:25:08Z)

### Session summary

Executed all six planned TDD cycles plus one Tidy-First preparatory commit, landing owner-only file modes for both JSONL logs and the permission-forwarding artifacts, key-name redaction at two application points, and ADR 0010.
Eight commits total; test count went from 2603 to 2665 (+62) across 127 → 130 files.
Pre-completion reviewer returned PASS on every section.

### Observations

- **The reds were real measurements, not ceremony.**
  Step 4's red reported `expected 420 to be 384` and `expected 493 to be 448` — that is `0o644` and `0o755`, reproducing the reporter's exact claim about umask-inherited modes before a line of the fix existed.
  Step 3's red reproduced the literal repro from the issue body.
- **The two-application-point design was load-bearing, and the plan was right to insist on it.**
  Redaction at `writeLine` alone would have left the reporter's own repro unfixed, because `getToolInputPreviewForLog` flattens tool input to a string before the writer ever sees its keys.
  The reviewer independently confirmed both points are covered and that no log write path bypasses `writeLine`.
- **The `vi.mock` partial-module trap fired exactly where the testing skill warns.**
  `test/tool-preview-formatter.test.ts` replaced `#src/json-safe-stringify` with a literal factory exporting only `safeJsonStringify`, which would have blanked out the `createJsonSafeReplacer` that `log-redaction.ts` builds on.
  Fixed with an `importActual` spread.
  Three existing `formatGenericToolInputForLog` tests also had to move to real serialization, since the log path no longer routes through the mocked prompt-path serializer — a net improvement, as they now assert real behavior.
- **Characterization tests before the move paid off immediately.**
  `safeJsonStringify`'s cycle / `Error` / `bigint` handling had zero coverage because both consumers mocked it away.
  Writing the eight tests first surfaced an undocumented quirk worth pinning: a repeated *non-cyclic* reference is also marked `[Circular]`, because `seen` entries are never released.
- **Deviation: `test/extension-config.test.ts` was touched but not named in the plan.**
  The logs-directory mode assertions had to live there, because `ensurePermissionSystemLogsDirectory` is in `src/extension-config.ts` and `test/logging.test.ts` supplies its own `ensureLogsDirectory` callback, so it cannot exercise the real one.
  The plan's Module-Level Changes should have caught this.
- **Deviation: an extra `docs:` commit for a distribution gap the plan missed.**
  `configuration.md` and `troubleshooting.md` ship in the npm tarball; `docs/decisions/` does not, so the ADR links would have been dead for anyone reading the installed package.
  Resolved by following the absolute-GitHub-URL precedent already set in `docs/subagent-integration.md` rather than adding `docs/decisions` to the `files` allowlist, which would ship ten internal design records to serve one user-facing reference.
  Verified with `pnpm pack` + `tar tzf`.
- **The permission gate caught an agent mistake mid-session.**
  An `Edit` call dropped the `pi-packages/packages/` prefix from a path; the `external_directory` gate blocked it and named the correct location.
  A live demonstration of the thing being hardened.
- **Tidy-First assessor was well-scoped.**
  One recommendation (extract a shared temp-dir fixture in `test/logging.test.ts`, which was about to gain two new scenarios), and its rejected list correctly declined three in-scope-but-unobstructive modules.
  It also recognized that the plan's own step-1 sequencing already *was* the tidy-first move for the riskiest friction rather than re-proposing it.
- Pre-completion reviewer: **PASS**, no warnings.
  It verified `isSensitiveLogKey` against every real key name the package logs and found no false positive — including confirming that the bash parser's internal `token` field is never logged directly.
