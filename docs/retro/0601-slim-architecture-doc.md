---
issue: 601
issue_title: "pi-permission-system: slim architecture.md to current state and open targets"
---

# Retro: #601 — Slim architecture.md to current state and open targets

## Stage: Planning (2026-07-16T14:53:44Z)

### Session summary

Produced a build-oriented plan (`docs/plans/0601-slim-architecture-doc.md`) for the operator-authored docs-only cleanup: five content operations on `architecture.md` (delete duplicated `### Phase 1–11` prose, fold `Target: the authority model` → `The authority model`, strip module-tree provenance, trim source-restating pseudo-code, add a package-skill regrowth guard) plus a two-directional link-graph sweep, sequenced as six `docs:` commits.
A mid-planning question about *ongoing* architecture-doc maintenance — and that pi-subagents (1265 lines) carries the same debt — was resolved with the operator and split into three follow-ups filed this session: #605 (pi-subagents bulk prune), #606 (extend `/finish-phase` with a doc-hygiene step), #607 (generalize the regrowth guard into a shared convention).

### Observations

- **Release posture:** ship independently, but this cuts no release at all — `docs/architecture` is a `release-please-config.json` `exclude-paths` entry and the one non-doc touch (`SKILL.md`) is in no package.
  Recorded as such rather than implying a release.
- **Skipped the `ask_user` design gate:** author is the operator (`gotgenes`) and the "Proposed change" is concrete and unambiguous, so per the plan template the gate was skipped for #601's scope.
  Used `ask_user` instead for the *process* question the operator raised (maintenance mechanism + which follow-ups to file).
- **`/finish-phase` is the producer, not just a bystander:** the `### Phase N` refactoring-history prose #601 deletes is written *by* `/finish-phase` Step 4 ("match the established style… pi-permission-system uses prose `### Phase N (complete)` subsections").
  That is why the ongoing-prevention mechanism belongs in `/finish-phase` (#606), not `/plan-improvements` — the latter is the read-cost *consumer* (the "three 50KB reads" the issue cites) and its cause-hypothesis discipline is code structure, not doc hygiene.
- **Anchor-rename fallout is bounded and documented:** renaming `## Target: the authority model` breaks `#target-the-authority-model`.
  Four in-file links (two survive → update; two live inside the deleted prose) plus one live sibling doc (`permission-prompter.md`).
  Frozen records (`history/`, old plans) keep their stale anchor deliberately — rewriting history is a Non-Goal.
- **Kept #601 tight:** deliberately did not balloon it to include pi-subagents or the `/finish-phase` change; those are #605/#606/#607, cross-referenced in the plan's Non-Goals and Open Questions.
- **Soft 750-line target:** treated as the issue's rough goal, not a gate; the real gates are zero information loss, a lint-clean link graph (MD053 both directions), and the preserved `## Improvement roadmap — Phase N (complete)` chain the `/plan-improvements` hard gate greps for.

## Stage: Implementation — Build (2026-07-16T15:40:00Z)

### Session summary

Executed all six build steps as `docs:` commits: dropped the duplicated `### Phase 1–11` refactoring-history prose, folded `Target: the authority model` → `The authority model` (cutting the shipped-narrated-as-pending parts, keeping every open-direction subsection), stripped issue-provenance trails from the ~130-entry module tree (keeping the ADR 0002 string-boundary and sole-`win32`-comparison active constraints), replaced the `normalizeFlatConfig()`/two-phase snippets with sentence-plus-pointer, and added the package-skill regrowth guard.
`architecture.md` went 1213 → 1063 lines and dropped 22.5KB (17%) — the module tree alone got 24% narrower — directly cutting the read cost the issue cited.
Pre-completion reviewer returned WARN (one finding), fixed inline; final full `pnpm run lint` clean.

### Observations

- **Two planned deviations, both justified and documented in commit bodies.** (1) The plan deferred all orphaned-link pruning to a separate step-6 commit, but per-step `pnpm run lint` (MD053) forces each commit to be valid, so orphan pruning was folded into the step that created it — step 6 became a no-op verification (bijective 65↔65 ref/def check). (2) The plan's Non-Goal to leave frozen-record anchors stale was untenable: renaming the heading breaks live in-repo link fragments, and rumdl MD051 validates them (flagged `0555`), so the anchor token was fixed in `0555` + the three `history/` files (prose byte-identical otherwise).
- **Line-count target missed honestly (1063 vs ~750), but the plan disclaimed it as soft.**
  The remaining bulk is content the issue's keep-list explicitly preserves (the authority-model open-direction subsections) plus the one-line-per-module tree floor; the real signal metric (bytes) dropped 17%.
- **Reviewer WARN was a rename side-effect, not a defect:** `.pi/skills/improvement-discovery/SKILL.md` cited the old heading name as its canonical first-principles-target example.
  Grepped exhaustively; the only other live reference was that skill (the `architecture.md` `**Target:**` hits are unrelated roadmap step-fields; the two retro hits are frozen).
  Fixed the skill in a 7th `docs:` commit.
- **Pre-completion reviewer: WARN → resolved.**
  Deterministic gates (check/lint/test/dead-code), Mermaid validation (7 diagrams), commit hygiene, and link-graph integrity all PASS.
