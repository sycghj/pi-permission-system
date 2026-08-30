import type { AccessPath } from "#src/access-intent/access-path";
import { BashProgram } from "#src/access-intent/bash/program";
import { getPathBearingToolPath } from "#src/access-intent/tool-input-path";
import {
  resolveShellInvocation,
  type ShellInvocation,
} from "#src/access-intent/tool-kind";
import type { ShellToolsConfig } from "#src/config-schema";
import { formatDenyReason } from "#src/denial-messages";
import { extractBashCapability } from "#src/learning/bash-capability-extractor";
import { gitProjectIdentity } from "#src/learning/capability-fingerprint";
import type { PathNormalizer } from "#src/path-normalizer";
import type { ScopedPermissionResolver } from "#src/permission-resolver";
import type { SkillPromptEntry } from "#src/skill-prompt-sanitizer";
import type { ToolAccessExtractorLookup } from "#src/tool-access-extractor-registry";
import type { ToolInputFormatterLookup } from "#src/tool-input-formatter-registry";
import {
  ToolPreviewFormatter,
  type ToolPreviewFormatterOptions,
} from "#src/tool-preview-formatter";
import type { PermissionCheckResult } from "#src/types";
import { resolveBashCommandCheck } from "./bash-command";
import { describeBashExternalDirectoryGate } from "./bash-external-directory";
import { describeBashNulRedirectGate } from "./bash-nul-redirect";
import { describeBashPathGate } from "./bash-path";
import { type GateResult, isGateDescriptor } from "./descriptor";
import { describeExternalDirectoryGate } from "./external-directory";
import { describePathGate } from "./path";
import { isSameRepoReadonlyGitCommand } from "./readonly-git-worktree";
import type { GateRunner } from "./runner";
import { describeSkillReadGate } from "./skill-read";
import { describeToolGate } from "./tool";
import type { GateOutcome, ToolCallContext } from "./types";

/**
 * Narrow interface the pipeline needs from its session-side dependency.
 *
 * The three query methods needed to assemble gate inputs.
 * The resolver is injected separately as a constructor parameter.
 *
 * `PermissionSession` satisfies this structurally at the construction call
 * site; no `implements` clause is needed and would create a layer-inversion
 * import from the domain module into the handler layer.
 */
export interface ToolCallGateInputs {
  /** Active skill prompt entries for the skill-read gate. */
  getActiveSkillEntries(): SkillPromptEntry[];
  /** Combined infrastructure read directories (static + config-derived). */
  getInfrastructureReadDirs(): string[];
  /** Resolved tool-preview formatter options from the current config. */
  getToolPreviewLimits(): ToolPreviewFormatterOptions;
  /** The session's path normalizer (platform + cwd baked in). */
  getPathNormalizer(): PathNormalizer;
  /**
   * The configured shell-tool aliases (`shellTools`), or `undefined` when none
   * are set. Consulted by {@link resolveShellInvocation} so an aliased shell
   * tool is gated through the bash stack at parity with native `bash` (#574).
   */
  getShellToolAliases(): ShellToolsConfig | undefined;
}

/**
 * Owns the ordered tool-call gate-producer assembly and the run loop.
 *
 * Constructed once in the composition root and injected into
 * `PermissionGateHandler`. `evaluate(tcc, runner)` encapsulates:
 * - bash-command extraction and single `BashProgram.parse` (#308)
 * - `ToolPreviewFormatter` construction from `getToolPreviewLimits()`
 * - infrastructure-dir list from `getInfrastructureReadDirs()`
 * - all six gate producers in their prescribed order
 * - the run loop that returns the first block outcome, or allow
 */
export class ToolCallGatePipeline {
  constructor(
    private readonly resolver: ScopedPermissionResolver,
    private readonly inputs: ToolCallGateInputs,
    private readonly customFormatters?: ToolInputFormatterLookup,
    private readonly customExtractors?: ToolAccessExtractorLookup,
  ) {}

  async evaluate(
    tcc: ToolCallContext,
    runner: GateRunner,
  ): Promise<GateOutcome> {
    for (const produce of await this.createGateProducers(tcc)) {
      const outcome = await runner.run(
        await produce(),
        tcc.agentName,
        tcc.toolCallId,
      );
      if (outcome.action === "block") {
        return outcome;
      }
    }
    return { action: "allow" };
  }

  /** Evaluate normal automatic authorities without opening a human prompt. */
  async evaluateAutomatic(
    tcc: ToolCallContext,
    runner: GateRunner,
  ): Promise<GateOutcome> {
    for (const produce of await this.createGateProducers(tcc)) {
      const outcome = await runner.runAutomatic(
        await produce(),
        tcc.agentName,
        tcc.toolCallId,
      );
      if (outcome.action === "block") {
        return outcome;
      }
    }
    return { action: "allow" };
  }

  /**
   * Evaluate only the deterministic deny floor. Ask and allow both pass, and
   * no prompt, learned grant, auto-mode decision, session grant, or event side
   * effect is consulted.
   */
  async evaluateDenyFloor(tcc: ToolCallContext): Promise<GateOutcome> {
    for (const produce of await this.createGateProducers(tcc)) {
      const gate = await produce();
      if (!isGateDescriptor(gate)) {
        continue;
      }
      const check =
        gate.preCheck ??
        (gate.preResolved
          ? {
              state: gate.preResolved.state,
              toolName: gate.surface,
              source: "tool" as const,
              origin: "builtin" as const,
            }
          : this.resolver.resolve({
              kind: "tool",
              surface: gate.surface,
              input: gate.input,
              agentName: tcc.agentName ?? undefined,
            }));
      if (check.state === "deny") {
        return {
          action: "block",
          reason: formatDenyReason(gate.denialContext),
        };
      }
    }
    return { action: "allow" };
  }

  private async createGateProducers(
    tcc: ToolCallContext,
  ): Promise<Array<() => GateResult | Promise<GateResult>>> {
    // Resolve the shell invocation once: native `bash` and any tool recorded in
    // `shellTools` both yield a command (+ optional workdir); every other tool
    // yields null (#574). The three bash gates then share one parsed program.
    const shell = resolveShellInvocation(
      tcc.toolName,
      tcc.input,
      this.inputs.getShellToolAliases(),
    );
    const normalizer = this.inputs.getPathNormalizer();
    const bashProgram = shell?.command
      ? await BashProgram.parse(shell.command, normalizer, {
          workdir: shell.workdir,
        })
      : null;
    const formatter = new ToolPreviewFormatter(
      this.inputs.getToolPreviewLimits(),
      this.customFormatters,
    );
    const bashCapability = bashProgram
      ? extractBashCapability({
          program: bashProgram,
          cwd: tcc.cwd,
          source: "tool_call",
          agentName: tcc.agentName,
          projectIdentity: gitProjectIdentity(`${tcc.cwd}/.git`),
        })
      : undefined;
    const infraDirs = this.inputs.getInfrastructureReadDirs();
    return [
      () =>
        describeSkillReadGate(tcc, normalizer, () =>
          this.inputs.getActiveSkillEntries(),
        ),
      () =>
        describePathGate(tcc, this.resolver, normalizer, this.customExtractors),
      () =>
        describeExternalDirectoryGate(
          tcc,
          infraDirs,
          this.resolver,
          normalizer,
          this.customExtractors,
        ),
      () => describeBashExternalDirectoryGate(tcc, bashProgram, this.resolver),
      () => describeBashNulRedirectGate(tcc, bashProgram, this.resolver),
      () => describeBashPathGate(tcc, bashProgram, this.resolver),
      () => {
        const { toolCheck, accessPath } = this.resolvePerToolCheck(
          tcc,
          shell,
          bashProgram,
          normalizer,
        );
        const toolDescriptor = describeToolGate(
          tcc,
          toolCheck,
          formatter,
          accessPath,
          shell,
        );
        if (bashCapability) {
          toolDescriptor.learning = {
            intentFingerprint: bashCapability.fingerprint,
          };
        }
        toolDescriptor.preCheck = sameRepoReadonlyGitCheck(
          tcc.cwd,
          bashProgram,
          toolCheck,
        );
        return toolDescriptor;
      },
    ];
  }

  /**
   * Resolve the per-tool gate's check, choosing the intent by tool shape:
   * bash chains its sub-commands; a path-bearing tool with a path emits an
   * `access-path` intent (so the per-tool surface matches lexical ∪ canonical,
   * #502); every other tool (and a path-bearing tool with no path) keeps the
   * raw `tool` intent the manager normalizes.
   *
   * Returns the `AccessPath` alongside the check so `describeToolGate` derives
   * the session-approval value from `accessPath.value()`.
   */
  private resolvePerToolCheck(
    tcc: ToolCallContext,
    shell: ShellInvocation | null,
    bashProgram: BashProgram | null,
    normalizer: PathNormalizer,
  ): { toolCheck: PermissionCheckResult; accessPath?: AccessPath } {
    if (shell) {
      if (bashProgram) {
        return {
          toolCheck: resolveBashCommandCheck(
            bashProgram.commandText(),
            bashProgram.commands(),
            tcc.agentName ?? undefined,
            this.resolver,
          ),
        };
      }
      // A shell invocation whose command did not parse (e.g. empty) still
      // resolves on the `bash` surface, so an aliased tool never falls through
      // to its own extension-tool surface.
      return {
        toolCheck: this.resolver.resolve({
          kind: "tool",
          surface: "bash",
          input: { command: shell.command },
          agentName: tcc.agentName ?? undefined,
        }),
      };
    }

    const filePath = getPathBearingToolPath(tcc.toolName, tcc.input);
    if (filePath !== null) {
      const accessPath = normalizer.forPath(filePath);
      return {
        accessPath,
        toolCheck: this.resolver.resolve({
          kind: "access-path",
          surface: tcc.toolName,
          path: accessPath,
          agentName: tcc.agentName ?? undefined,
        }),
      };
    }

    return {
      toolCheck: this.resolver.resolve({
        kind: "tool",
        surface: tcc.toolName,
        input: tcc.input,
        agentName: tcc.agentName ?? undefined,
      }),
    };
  }
}

function sameRepoReadonlyGitCheck(
  cwd: string,
  bashProgram: BashProgram | null,
  fallback: PermissionCheckResult,
): PermissionCheckResult {
  if (
    fallback.state === "ask" &&
    bashProgram &&
    isSameRepoReadonlyGitCommand(bashProgram.commandText(), cwd)
  ) {
    return {
      state: "allow",
      toolName: "bash",
      source: "bash",
      origin: "builtin",
      command: bashProgram.commandText(),
      matchedPattern: "<same-repo-readonly-git>",
    };
  }
  return fallback;
}
