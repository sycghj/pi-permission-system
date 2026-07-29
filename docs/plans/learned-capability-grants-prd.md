# Learned Capability Grants PRD

## Status

Draft for implementation planning.

## Problem

`pi-permission-system` currently asks too often for repeated, user-approved work.
This is especially painful when agents operate in git worktrees, run normal build or test commands, inspect code with read/search tools, or repeat bounded local and remote workflows.
At the same time, broad rules such as `bash "*" = allow`, `python = allow`, or `ssh = allow` are too dangerous because a single executable can represent many different capabilities.

The system needs to reduce repeated prompts without turning one approval into a wide, persistent permission rule.

## Goals

- Treat a user approval as evidence, not as an implicit permanent allow rule.
- Create reusable grants only for structured, bounded capabilities.
- Allow users to correct risk classification and reduce friction for trusted workflows such as same-repository `dotnet build/test`.
- Keep hard safety invariants: learned grants must not override explicit denies, hard safety gates, or unparseable high-risk behavior.
- Provide explainability: every automatic allow must be traceable to a grant, scope, matcher, TTL, use count, and approval evidence.
- Support high-frequency R2 workflows after explicit bounded review, not repeated manual prompts forever.

## Non-Goals

- Do not learn broad executable rules such as `dotnet *`, `python *`, `ssh *`, `scp *`, or `curl *`.
- Do not create persistent cross-session grants in the MVP.
- Do not let auto-mode or an LLM create or widen active grants by itself.
- Do not allow learned grants to override explicit `deny` configuration.
- Do not automatically learn opaque heredocs, arbitrary remote shells, arbitrary credential egress, broad recursive deletion, production changes, persistence, privilege escalation, or permission-system self-modification.

## Key Concepts

### Approval Evidence

A direct user approval records what the user accepted in that moment.
Evidence is used to suggest or create a bounded grant, but is not itself a reusable grant.

Evidence should record:

- principal and source: user, agent, `tool_call` vs `user_bash`;
- request surface and tool;
- normalized capability intent;
- project/worktree identity where available;
- timestamp and approval kind: once, session, or explicit reusable grant;
- denial reason when applicable.

Session-approved or auto-mode-approved repeats must not count as new independent approval evidence.

### Capability Intent

A capability intent is a structured description of what an operation does.
It is not a raw shell string.
Example capability families:

- local observation: `pwd`, metadata reads;
- local inspection: safe `git diff`, safe `rg`, stdout-only `sed`;
- trusted local execution: bounded `dotnet build/test` in a trusted repo;
- document export workflow: fixed script or fixed extracted operation set;
- provider egress: fixed method, host, path, and credential source;
- remote workflow: fixed host identity, script hash, destination, and command.

Each intent has a fingerprint derived from parsed structure, critical arguments, script hashes, project identity, environment constraints, and parser version.

### Learned Grant

A learned grant is a bounded rule that can turn an otherwise `ask` result into an `allow`.
It has:

- matcher and positive/negative examples;
- scope: user, project identity, worktree equivalence, agent, source;
- risk tier or mode;
- TTL and use-count limit;
- creation evidence;
- audit trail and revocation state.

Learned grants must only consume `ask`.
They must never override `deny`.

### Capability Allowlist

Some useful workflows are not safe to infer from repeated `Yes`.
They still may be frequent and legitimate.
These require explicit bounded review.

Examples:

- fixed `scp` plus `ssh` health-check script;
- API-key connectivity test to a configured provider endpoint;
- PowerPoint/Office export workflow with fixed input/output/delete bounds;
- trusted `dotnet build/test` profile for a specific repository.

## Risk and Friction Model

Risk tiers are implementation labels.
Product copy should prefer capability language such as "local read", "trusted local execution", or "bounded remote workflow".

| Tier | Meaning                                                                                                     | Friction Policy                                                                           |
| ---- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| R0   | Pure observation with no writes, network, secrets, or code execution.                                       | Auto-learnable in short TTL/session scope.                                                |
| R1   | Bounded local inspection or low-risk local workflow.                                                        | Auto-learnable after evidence; short TTL/use-count.                                       |
| R2   | Bounded execution, writes, local app automation, remote workflow, or trusted code execution.                | User-grantable: explicit reusable grant review first, then automatic while in scope.      |
| R3   | Sensitive or broad capability: credentials, arbitrary remote execution, opaque code, broad upload/download. | Not auto-learnable; may require explicit static/admin capability or per-run confirmation. |
| R4   | Severe, irreversible, privilege, persistence, production, or permission-system bypass.                      | Never learn; hard deny or special out-of-band process.                                    |

Important correction: R2 does not mean every execution must be manually approved.
R2 means the reusable grant must be created explicitly with a bounded matcher.
Once created, matching operations can be automatically allowed until TTL/use-count or scope expiry.

## Risk Classification Overrides

Users must be able to correct an overly conservative classification.
The unit of correction is not an executable name; it is a structured capability in a bounded scope.

Allowed examples:

- `R2 -> R1-like` for `dotnet build/test` in trusted repo `VisionNext`, limited to project files inside same-repo worktrees, no restore/network, and writes only to build/test output directories.
- `R3 -> R2` for a fixed remote health-check workflow with host identity, script hash, destination, and command template bound.
- `R3 -> R2` for a fixed document export workflow with script hash, allowed input range, output directory, and deletion bound to generated preview directories.

Rejected examples:

- `dotnet * -> R0/R1` because it includes publish, restore, tool install, run, and other code/network/publish behaviors.
- `python * -> R1` because it is arbitrary interpreter execution.
- `ssh * -> R1/R2` because it is arbitrary remote execution.
- `curl * with secrets -> R1/R2` because it is unbounded credential egress.

The UI and config should expose this as "adjust risk classification" or "trust this bounded workflow", not as "lower risk for this executable".

## Decision Order

The permission pipeline should preserve this order:

1. Hard safety gates.
2. Explicit deterministic deny.
3. Deterministic allow or identity bypass, such as same-repository worktree.
4. Session approval.
5. Learned grant evaluator.
6. Auto-mode classifier.
7. Human or forwarded prompt.
8. Evidence recorder and audit log.

Learned grants only run after explicit deny and before auto-mode.
They can only convert `ask` to `allow`.

## UX Requirements

### First-Level Prompt

The first prompt should answer only whether to run the current request.

Recommended buttons:

- `Allow once`
- `Allow for session`
- `Deny` with reason menu
- `Review reusable grant` when a bounded grant is available or suggested

Avoid broad labels such as `Allow python`, `Allow ssh`, or `Allow dotnet`.

### Reusable Grant Review

The review page must show:

- what will match;
- what will not match;
- scope: repo, worktree identity, agent, user, source;
- allowed reads/writes/network/secrets/remote behavior;
- TTL and use-count;
- risk/capability mode and why;
- fingerprint/script hash/host key where relevant;
- why the grant was suggested.

### Correction Flows

If the user dislikes the options, offer three corrections:

- `Trust this bounded workflow`: create or propose a narrower reusable grant.
- `Narrow this suggestion`: reduce scope, TTL, use count, agent, paths, or command variants.
- `Do not suggest this pattern`: suppress future reusable grant suggestions for this family.

For `dotnet build/test`, a correction flow can produce a trusted repo profile:

- subcommands: `build`, `test`;
- project paths inside the same repository/worktree;
- no restore/network unless separately granted;
- no publish/run/tool/install;
- allowed writes limited to `bin/`, `obj/`, `TestResults/`, and configured temp output directories;
- TTL/use-count bounded.

## Example Policies

### Safe Local Inspection

- `pwd`: R0, short TTL/session grant is acceptable.
- `git diff`: R1 only if external diff, unsafe env, pipes, redirection, and paths outside the repo are excluded.
- `rg`: R1 only if `--pre`, unsafe symlink traversal, external paths, and shell composition are excluded.
- `sed`: R1 only for stdout-only use; reject or elevate `-i`, `w`, `e`, and output redirection.

### Trusted Dotnet Workflow

`dotnet build/test` in a trusted repository is not pure observation, but it can be a low-friction bounded workflow.

An acceptable reusable grant must bind:

- repository identity, including same-repo worktrees;
- subcommands `build` and/or `test`;
- project paths inside repo/worktree;
- restore/network behavior;
- allowed output directories;
- forbidden subcommands such as `run`, `publish`, `tool`, `nuget push`, and broad arbitrary arguments.

### Remote Health Check Workflow

`scp` plus `ssh` may be R2 when all of these are fixed:

- remote host and user;
- host key identity;
- local file or script content hash;
- remote destination;
- remote command template;
- no interactive shell, port forwarding, proxy command, arbitrary upload, or command suffix.

Otherwise it remains R3/R4.

### Document Export Workflow

Python/Office automation may be R2 when converted into a bounded workflow:

- fixed script hash or fully extracted operation set;
- fixed input path range;
- fixed output root;
- deletion limited to generated preview directories after canonical path checks;
- no network, secrets, arbitrary interpreter behavior, or unbounded `rmtree`.

Opaque heredocs remain high friction until structured.

### Provider Egress

Credential egress requires explicit provider capability, not learned executable rules.
Bind:

- credential source handle;
- scheme, host, port, method, and path;
- redirect policy;
- TLS/host identity expectations where available.

## Configuration Shape

MVP config should be minimal and safe:

```json
{
  "learning": {
    "enabled": false,
    "mode": "shadow",
    "maxTtlMinutes": 120,
    "maxUses": 30,
    "autoActivateTiers": ["R0", "R1"]
  },
  "riskOverrides": [],
  "capabilityAllowlist": {
    "egress": [],
    "remoteWorkflows": [],
    "localWorkflows": []
  }
}
```

Example trusted dotnet profile:

```json
{
  "name": "visionnext-trusted-dotnet-tests",
  "from": "R2",
  "to": "R1",
  "capability": "dotnet-build-test",
  "scope": {
    "projectIdentity": "git:D:/code/VisionNext/.git",
    "agents": ["trellis-code-review", "trellis-implement"]
  },
  "constraints": {
    "subcommands": ["build", "test"],
    "requireNoRestore": true,
    "allowWrites": ["bin/**", "obj/**", "TestResults/**"],
    "denyNetwork": true,
    "denySecrets": true
  },
  "ttlMinutes": 480,
  "maxUses": 30
}
```

Schema validation must reject impossible overrides such as `dotnet * -> R0`.

## Management Commands

Planned command surface:

- `pi permissions learned list`
- `pi permissions learned explain <grant-id>`
- `pi permissions learned explain -- <command>`
- `pi permissions learned revoke <grant-id>`
- `pi permissions learned clear --expired|--scope <scope>|--all`
- `pi permissions learned audit`

`explain` must be able to show why a command matched or missed a grant.

## MVP Implementation Scope

Implement first:

1. Capability intent and fingerprint primitives.
2. Risk tier and eligibility rules.
3. Evidence recording for direct user approvals and denials.
4. In-memory or session-scoped learned grant store with TTL/use-count.
5. Learned evaluator that only consumes `ask`.
6. Safe R0/R1 extractors for `pwd`, safe `git diff`, safe `rg`, and stdout-only `sed`.
7. Trusted dotnet workflow design as explicit R2 user-grantable profile; do not auto-learn broad `dotnet`.
8. Shadow and suggestion mode audit events.
9. Explain/revoke internals sufficient for tests, even if CLI is deferred.

Defer:

- persistent grant storage;
- full UI implementation;
- egress allowlist enforcement;
- remote workflow enforcement;
- Office/document export workflow enforcement;
- cross-device or team policy sync.

## Acceptance Criteria

- Learned grants cannot turn a deterministic `deny` into `allow`.
- Hard safety cases never become learned active grants.
- Unknown or parse-failed commands do not become learned active grants.
- R0/R1 repeated benign commands can be represented as short TTL/use-count grants.
- Trusted `dotnet build/test` can be represented as a bounded user-grantable profile, while `dotnet *` is rejected as too broad.
- Each automatic allow has an audit/explain trail.
- Denial feedback can suppress or revoke matching candidate grants.
- Same-repository worktree identity is preserved in scope and matching.
