---
name: markdown-conventions
description: |
  Markdownlint rules, documentation frontmatter schema, and architecture doc conventions.
  Load when writing or editing markdown files.
---

# Markdown Conventions

Load this skill when writing or editing markdown files in this project.

## Formatting rules

- Use one sentence per line (unbroken) for better diffs.
- Always specify a language on fenced code blocks (e.g., ` ```typescript `, ` ```bash `, ` ```jsonc `, ` ```text `); use `text` for plain output.
- Use sequential numbering (`1.` `2.` `3.`) in ordered lists, restarting at `1.` under each new heading — markdownlint's MD029 rejects continued numbering across section boundaries.
- Do not use bold text (`**...**`) as a substitute for headings — use proper heading syntax; markdownlint's MD036 rejects emphasis used as headings.
- When embedding markdown that itself contains fenced code blocks, use a 4-backtick outer fence (` ````markdown `).
- Use compact table style with no cell padding — markdownlint's MD060 enforces consistent column style and is not auto-fixable.
  Example: `| Header | Header |` / `| --- | --- |` / `| cell | cell |` — spaces inside pipes, no padding variation.
- Separate adjacent blockquotes with an HTML comment (`<!-- -->`) to satisfy markdownlint's MD028.

## Documentation frontmatter

Docs under `docs/plans/` and `docs/retro/` use YAML frontmatter for structured metadata.
GitHub renders it as a table at the top of the file.

Schema (both fields are strings/numbers — quote any title containing backticks or colons):

```yaml
---
issue: 14 # optional: omit for plans that predate issue tracking
issue_title: "Per-agent permission frontmatter overrides" # required
---
```

- `issue` stores the number only, never a URL.
- Do not duplicate frontmatter fields as inline metadata in the body (e.g., `Issue #N` in the H1 is fine; a separate `**Issue:** #N` line is not).
- Other doc types (`README.md`) do not use frontmatter.

## Architecture docs

- `docs/architecture/v3-architecture.md` is a historical snapshot — do not update it.
- `docs/architecture/architecture.md` is the living architecture doc — update it when implementation changes.
- Per-module architecture notes (`docs/architecture/<module>.md`) describe current implementation.
