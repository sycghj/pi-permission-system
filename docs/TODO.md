# Roadmap and known limitations

`@sycghj/pi-permission-system` v24.1.0 is an early public release.
It is a policy-enforcement layer for Pi tool calls, not an operating-system sandbox or a substitute for process, container, account, or filesystem isolation.

This document records confirmed limitations that matter to the advertised permission boundary and the concrete work planned for a later patch release.
There is no promised delivery date.

## P0 — create-time bare redirect targets can miss path gates

**Origin:** inherited from the upstream Bash path-projection implementation.

The Bash parser collects redirect destinations, but the current projection does not preserve the fact that a token came from a redirect.
A bare destination that does not yet exist can therefore be rejected by the general bare-token existence probe before the `path` and `external_directory` surfaces see it.

Examples include a newly created `>output.log` and Windows Git Bash `2>NUL`.
Absolute, home-relative, parent-relative, drive-letter, and separator-bearing destinations remain shape-classified independently of existence.

This conflicts with upstream ADR 0009, which lists redirect targets inside the guaranteed projection boundary.
Until fixed, do not rely on the path surfaces alone to contain create-time Bash writes: keep Bash policy restrictive, review `ask` decisions, and use OS-level isolation where a hard security boundary is required.

Planned work:

- Add RED tests for new bare redirect destinations on POSIX and Windows-flavored Bash inputs.
- Preserve redirect provenance through token collection and path resolution.
- Make redirect destinations bypass only the bare-token existence probe, while retaining normal path normalization and policy evaluation.
- Add regression coverage for existing files, device sinks, absolute destinations, append redirects, and file-descriptor-prefixed redirects.
- Prepare an upstream report or narrowly scoped upstream patch because the originating behavior is inherited.

## P0 — autoMode can overstate that a Bash command is read-only

**Origin:** fork-only `capability-projection` heuristic.

The current autoMode prompt summary classifies commands beginning with selected read-oriented programs, including `rg` and `ls`, as `read-only, local`.
It does not account for shell redirection or other compound-command effects.
For example, `rg pattern >output` can receive a misleading read-only summary.

This summary does not override a deterministic `deny`, but it can bias the classifier when the deterministic result is `ask`.
Users who require conservative behavior should leave autoMode disabled (the default) until this is fixed.

Planned work:

- Add RED tests for redirects, pipelines, command substitutions, sequencing, and background execution.
- Remove the read-only claim whenever shell effects are present or cannot be proven absent.
- Prefer a conservative `unknown` effect over command-prefix inference.
- Verify the fix against the golden corpus and a dedicated adversarial Bash-effect corpus before publishing a patch release.

## Patch-release exit criteria

A patch addressing these items is not ready until:

- The new regression tests pass on Linux and Windows path flavors.
- TypeScript, lint, public-type verification, and the existing test suite complete with no new failures.
- README limitations and release notes match the implemented behavior.
- The published package is tested from a clean isolated Pi agent directory.
