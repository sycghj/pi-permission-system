# Skill Permission Inference PRD

## Problem

Pi users can install skills globally or import them from repositories.
Those skills often contain practical tool instructions such as local search commands, diagram post-processing commands, or project-specific generation workflows.
Today, pi-permission-system sees the resulting tool calls mostly as ordinary read/bash requests.
That causes unnecessary prompts for commands that are clearly part of a user-installed skill, such as Everything CLI searches from `everything-cli`.

Two tempting solutions are not acceptable:

- Per-skill adapters in pi-permission-system do not scale.
  They require the permission system maintainer to encode every skill's private behavior.
- A mandatory Skill Permission Protocol or manifest also does not scale.
  Existing skills should not need a heavyweight rewrite before users can adopt pi-permission-system.

The product requirement is therefore **zero-touch skill compatibility**:

> Existing skills must remain usable without modification. pi-permission-system should infer low-risk skill capabilities locally, learn from user approvals, and reduce repeated prompts without uploading skill content or weakening hard safety boundaries.

## Goals

- Allow safe reads of user-installed global skill documentation without broad access to the whole Pi agent directory.
- Infer skill capabilities from existing `SKILL.md` files, `allowed-tools` hints, actual tool calls, and user approval evidence.
- Keep inference local-first and deterministic-first; do not require external API calls.
- Let repeated low-risk skill commands become R1 auto-allow with audit after sufficient local evidence.
- Give auto-mode richer context for uncertain R2 decisions instead of forcing the classifier to reason from a raw command string.
- Preserve explicit denies, sensitive path protections, secret/network exfiltration protections, write/delete protections, and parse-failure safety.

## Non-Goals

- Do not require skill authors to add `permissions.json`, frontmatter, or a custom protocol.
- Do not add hardcoded TypeScript adapters for every skill.
- Do not treat `allowed-tools: Bash` as broad bash authorization.
- Do not upload skill content to external providers by default.
- Do not let inferred search/list permissions automatically authorize reading, editing, deleting, or exfiltrating matched files.

## Design Principle

Skill permission support should be an internal compatibility layer, not a contract skills must implement.

```text
Existing skill
  -> local skill document read
  -> static skill mining
  -> runtime command analysis
  -> user approval evidence
  -> local skill permission profile
  -> R0/R1/R2/R3 decision
```

Optional manifests may be supported later as an accuracy enhancement, but they must not be the adoption path.

## Trust Model

Skill trust is a signal, not authorization by itself.

| Source                     | Meaning                                            | Max automatic effect                                                                             |
| -------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| User-global skill          | Installed under the user's global skills directory | R1 for inferred low-risk capabilities; narrow R0 only for skill doc reads and very safe commands |
| Project skill              | Comes from the workspace repository                | R1 only inside trusted workspace boundaries; workspace-external behavior remains R2/R3           |
| Package skill              | Provided by an installed package                   | Depends on user installation/trust record; otherwise treat as project/unknown                    |
| Temporary or unknown skill | Prompt-only or unclear source                      | No deterministic R0/R1; may enrich auto-mode only                                                |

The skill identity should include at least:

```ts
interface SkillIdentity {
  name: string;
  scope: "user-global" | "project" | "package" | "temporary" | "unknown";
  root: string;
  skillFile: string;
  contentHash: string;
}
```

If the skill content hash changes, previously inferred grants for that exact skill content should stop matching until revalidated.

## Risk Levels

### R0: Deterministic Allow

Use sparingly.
Suitable for:

- Reading `SKILL.md` and adjacent documentation within a canonical user-global skill root.
- Very narrow, parsed, read-only commands with no network, no writes, no sensitive paths, no sensitive terms, and bounded output.

Example:

```powershell
es.exe -name Sparkle.exe -n 20
```

R0 must be auditable when it comes from skill inference.

### R1: Auto-Allow With Audit

The main target for repeated low-risk skill commands.

Requirements:

- User-global or otherwise trusted skill provenance.
- Command matches a locally inferred capability profile or strong static/runtime evidence.
- Generic analyzer confirms read-only behavior, bounded output, no network sink, no write/delete, no sensitive roots, and no sensitive terms.
- Any previous user approval evidence is represented as structured capability evidence, not raw string replay.

Example:

```powershell
es.exe sparkle | Select-Object -First 100
```

### R2: Auto-Mode Review With Skill Context

Use when behavior is plausible but evidence or bounds are incomplete.

Examples:

```powershell
es.exe sparkle
es.exe -path C:\Users\tzcbz sparkle | Select-Object -First 100
```

The auto-mode prompt should include structured local facts:

```text
This command appears related to user-installed global skill "everything-cli".
The skill document or local profile associates es.exe with local path search.
Analyzer result: read-only path enumeration, no network sink, no writes detected.
Output bound: 100 results / unknown.
Sensitive roots/terms: none detected / detected.
```

### R3: Ask Or Deny

Always keep user confirmation or deterministic denial for:

- `AppData`, browser profiles, `.ssh`, `.gnupg`, provider/model config, and other credential-bearing directories.
- Terms such as `password`, `token`, `secret`, `credential`, `apiKey`, `apikey`, `bearer`.
- Network sinks such as `curl`, `wget`, `Invoke-WebRequest`, `scp`, `ssh`, uploads, or webhooks.
- Writes, deletes, chmod, persistence, or process injection.
- Parse failures, opaque wrappers, semicolon chains, or unknown redirection.
- Unbounded broad local enumeration.

Credential discovery plus network egress should be deterministic deny, not just ask.

## Local-First Inference

Skill inference must not depend on external APIs.

### Default Mode: Local Static Analysis

The default extractor runs locally and deterministically:

- Parse frontmatter if present.
- Read `allowed-tools` as a hint only.
- Extract fenced code blocks and inline commands.
- Identify shell snippets, executable names, path-like arguments, output limiting idioms, and command families.
- Never treat extracted examples as direct authorization.

### Runtime Facts

Actual tool calls are stronger than static guesses.
The command analyzer should extract:

- executable chain and primary executable;
- shell wrapper (`bash`, `cmd.exe`, PowerShell);
- argv and flags;
- pipes and redirections;
- network sinks;
- write/delete actions;
- path arguments;
- bounded output controls such as `head -n`, `Select-Object -First`, `-n`, or tool-specific limit flags when generically recognizable;
- sensitive roots and sensitive terms.

### User Approval Evidence

When the user approves a skill-associated command, record structured evidence:

```json
{
  "kind": "skillCapabilityEvidence",
  "skill": "everything-cli",
  "skillHash": "...",
  "capability": "command.readOnlySearch",
  "executable": "es.exe",
  "constraints": {
    "network": "none",
    "writes": "none",
    "deletes": "none",
    "boundedOutput": true,
    "maxResults": 100,
    "sensitiveRoots": "ask",
    "sensitiveTerms": "ask"
  },
  "approvedByUser": true
}
```

Do not learn only the raw command string.

## Local Skill Profiles

Store inferred profiles under pi-permission-system's own state directory, not inside the skill.

Example:

```json
{
  "schemaVersion": 1,
  "skill": {
    "name": "everything-cli",
    "scope": "user-global",
    "root": "C:\\Users\\tzcbz\\.pi\\agent\\skills\\everything-cli",
    "contentHash": "abc123"
  },
  "inferredCapabilities": [
    {
      "id": "cap-001",
      "kind": "command.readOnlySearch",
      "executables": [
        "C:\\Program Files\\Everything\\es.exe",
        "es.exe"
      ],
      "evidence": [
        { "source": "skill-doc-example", "confidence": 0.78 },
        { "source": "user-approved-command", "confidence": 1.0 }
      ],
      "constraints": {
        "network": "none",
        "writes": "none",
        "deletes": "none",
        "maxResults": 100,
        "sensitiveRoots": "ask",
        "sensitiveTerms": "ask"
      },
      "maxAutoRisk": "R1"
    }
  ]
}
```

Profiles are local compatibility artifacts.
They are not a required skill format and should not be written back into downloaded/imported skill repositories.

## Active Skill Provenance

Because tool calls may not carry a direct `activeSkill`, use graded provenance.

| Provenance                 | Meaning                                                                                       | Max suggested automatic effect |
| -------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------ |
| Explicit active skill      | Runtime explicitly identifies the skill, or the user invoked a skill command                  | R0/R1 depending on risk        |
| Document loaded            | This turn read canonical `SKILL.md`, and the command matches that skill's inferred capability | R1, not R0                     |
| Installed capability match | Command matches a unique user-global skill profile, but no active skill is known              | R1/R2 depending on evidence    |
| Available-only             | Skill was available in prompt but not clearly used                                            | R2 context only                |
| None                       | No relation to a skill                                                                        | Normal permission pipeline     |

The tracker must be session-scoped and turn-scoped.
Active skill state must not leak across turns, sessions, reloads, or sibling agents.

## Permission Pipeline Integration

Recommended order:

```text
1. Parse and normalize tool request.
2. Apply hard safety and explicit denies.
3. Apply existing deterministic allows and infrastructure/session bypasses.
4. Identify skill provenance.
5. Run local command/read analyzer.
6. Evaluate skill inference policy.
7. R0/R1: allow with audit.
8. R2: enrich auto-mode context and continue.
9. R3: ask or deny.
10. Continue to learning, auto-mode, and UI prompt when deferred.
```

Skill inference must never override explicit deny.
It must also not grant broad bash access.
A safe `readOnlySearch` capability is not permission to read all returned files.

## External Model Policy

External APIs must be optional and off by default.

Default configuration:

```json
{
  "skills": {
    "enabled": true,
    "allowGlobalSkillDocsRead": true,
    "inference": {
      "enabled": true,
      "mode": "local-static",
      "sendSkillDocs": false,
      "useExternalModel": false,
      "useLocalModel": false
    }
  }
}
```

If external model assistance is enabled, it must be explicit opt-in:

```json
{
  "skills": {
    "inference": {
      "useExternalModel": true,
      "sendSkillDocs": "ask",
      "redactBeforeSend": true,
      "sendOnlyExtractedCommandSnippets": true
    }
  }
}
```

Rules for model assistance:

- Do not send skill documents by default.
- Prefer sending extracted command snippets over full documents.
- Redact tokens, API keys, long secrets, private hostnames, home paths, and credential files before any send.
- Model output is advisory only.
  It can propose a capability candidate, but local deterministic analysis decides allow/ask/deny.
- Enabling auto-mode for permission decisions does not imply consent to upload skill documentation for offline inference.

## Configuration Shape

Suggested user-facing configuration:

```json
{
  "skills": {
    "enabled": true,
    "allowGlobalSkillDocsRead": true,
    "mode": "shadow",
    "trust": {
      "userGlobal": true,
      "project": "trusted-project-only",
      "package": "explicit-install-only",
      "temporary": false
    },
    "defaults": {
      "maxRiskWithoutPrompt": "R1",
      "unknownSkillMaxRisk": "R2",
      "projectSkillMaxRisk": "R1"
    },
    "inference": {
      "mode": "local-static",
      "sendSkillDocs": false,
      "useExternalModel": false,
      "useLocalModel": false
    },
    "sensitiveRoots": [
      "%USERPROFILE%\\AppData",
      "%USERPROFILE%\\.ssh",
      "%USERPROFILE%\\.gnupg",
      "%PI_AGENT_DIR%",
      "%PI_AGENT_DIR%\\models.json"
    ],
    "sensitiveTerms": [
      "password",
      "token",
      "secret",
      "credential",
      "apikey",
      "api-key",
      "bearer"
    ],
    "auditR0": true,
    "auditR1": true
  }
}
```

Local user overrides may exist, but they should constrain inferred behavior rather than requiring skill changes:

```json
{
  "skills": {
    "localOverrides": {
      "everything-cli": {
        "trust": "user-global",
        "maxAutoRisk": "R1",
        "allowedRoots": ["D:\\code", "F:\\code"],
        "maxResults": 100,
        "sensitiveRoots": "ask"
      }
    }
  }
}
```

## Everything Example Without A Dedicated Adapter

Existing `everything-cli` should not require modification.

Expected flow:

1. pi-permission-system allows reading `everything-cli/SKILL.md`.
2. Local static mining extracts `es.exe` examples and marks them as hints.
3. Runtime analyzer sees commands such as:

   ```powershell
   powershell -NoProfile -Command "& 'C:\Program Files\Everything\es.exe' sparkle | Select-Object -First 100"
   ```

4. Analyzer derives:

   ```json
   {
     "capability": "command.readOnlySearch",
     "boundedOutput": true,
     "maxResults": 100,
     "network": false,
     "writes": false,
     "sensitiveRoots": [],
     "sensitiveTerms": []
   }
   ```

5. First uncertain execution may go R2/ask.
6. User approval records structured local evidence.
7. Later equivalent low-risk searches become R1 allow with audit.
8. `AppData`, secret terms, or network pipes remain R3 ask/deny.

This uses generic command analysis and local profiles, not an Everything-specific permission adapter.

## Observability

Add events that make decisions explainable:

```text
skill.doc_read_allowed
skill.provenance_detected
skill.static_mined
skill.command_analyzed
skill.capability_inferred
skill.profile_candidate_recorded
skill.profile_evidence_recorded
skill.profile_allowed
skill.profile_deferred
skill.profile_blocked
skill.external_inference_requested
skill.external_inference_blocked
```

Logs should include capability identifiers, source type, risk level, and miss reasons.
Logs must avoid recording raw secrets or full sensitive query strings.

## TDD Implementation Plan

### Phase 1: Global Skill Doc Read

RED tests:

- Read `~/.pi/agent/skills/<name>/SKILL.md` allows.
- Read `~/.pi/agent/skills/<name>/references/*.md` allows.
- `../` escape from a skill root is blocked.
- Symlink or junction escape from skill root is blocked.
- Read `~/.pi/agent/models.json` remains ask/deny.
- Read extension config remains ask/deny.

### Phase 2: Skill Identity And Provenance

RED tests:

- User-global skill identity includes root, skill file, scope, and content hash.
- Project skill identity is lower trust than user-global.
- Document-loaded provenance is turn-scoped.
- Installed capability match does not create R0.
- Reload/session switch clears active provenance.

### Phase 3: Local Static Miner

RED tests:

- Extracts fenced PowerShell/cmd/bash commands.
- Extracts narrow `allowed-tools` hints.
- Treats broad `allowed-tools: Bash` as hint only.
- Produces candidate capabilities, not grants.
- Does not send external requests.

### Phase 4: Generic Command Analyzer

RED tests:

- Unwraps PowerShell and cmd wrappers.
- Detects primary executable and argv.
- Detects `Select-Object -First N` and `head -n N` bounds.
- Detects network sinks.
- Detects writes/deletes/redirections.
- Detects sensitive roots and terms.
- Parse failure returns ask/defer, never allow.

### Phase 5: Local Skill Profile Store

RED tests:

- Stores profile under permission-system state, not skill root.
- Stores structured capability evidence after user approval.
- Skill content hash change invalidates previous profile match.
- Shadow mode records candidates without allowing.
- Active mode allows only bounded low-risk profile matches.

### Phase 6: Pipeline Integration

RED tests:

- Explicit deny outranks inferred skill allow.
- R1 skill profile match bypasses classifier and audits.
- R2 enriches auto-mode with skill context.
- R3 asks/denies.
- Search permission does not authorize reading returned files.

### Phase 7: External Model Safeguards

RED tests:

- Default config never sends skill docs externally.
- Enabling auto-mode does not enable skill doc upload.
- External inference requires explicit config and/or ask.
- Redaction runs before outbound model requests.
- Model result is advisory and cannot bypass local safety checks.

## Rollout

1. Ship in `shadow` mode: mine skills, analyze commands, record candidate profiles, and log what would have happened.
2. Enable global skill doc read as active R0/R1.
3. Enable R1 active allow only for user-global skills with structured user approval evidence.
4. Add R2 auto-mode enrichment.
5. Later, optionally support user-provided manifests as an accuracy accelerator, not as a requirement.

## Safety Red Lines

- No external skill upload by default.
- No parse-failure allow.
- No broad bash allow from `allowed-tools: Bash`.
- No explicit deny override.
- No secret search plus network egress.
- No skill self-authorization by project content.
- No inherited permission from search/list to read/write/delete.
- No profile reuse after skill hash changes.
- No active skill leakage across turns or sessions.
- No sensitive query/token logging.

## Summary

The publishable design is **Skill Permission Inference**, not per-skill adapters and not a mandatory protocol.
Existing skills remain zero-touch. pi-permission-system locally mines skill docs, analyzes runtime commands, learns from user approvals, and stores local profiles.
Optional manifests and optional model assistance can improve accuracy later, but the core system must work without changing skills and without sending skill contents to external APIs.
