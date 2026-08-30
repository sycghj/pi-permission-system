import type { AskEscalator } from "#src/authority/authorizer-selection";
import type { PermissionPromptDecision } from "#src/authority/permission-dialog";
import type { DecisionReporter } from "#src/decision-reporter";
import {
  formatDenyReason,
  formatUnavailableReason,
  formatUserDeniedReason,
} from "#src/denial-messages";
import type { EvidenceRecorder } from "#src/learning/evidence-recorder";
import type { LearnedGrantEvaluator } from "#src/learning/learned-grant-evaluator";
import type { PermissionDecisionReason } from "#src/permission-events";
import { applyPermissionGate } from "#src/permission-gate";
import type { ScopedPermissionResolver } from "#src/permission-resolver";
import type { SessionApprovalRecorder } from "#src/session-approval-recorder";
import type { PermissionCheckResult } from "#src/types";
import type { AutoAskDecider } from "./auto-ask-decider";
import type { GateDescriptor, GateResult } from "./descriptor";
import { isGateBypass } from "./descriptor";
import { buildDecisionEvent, deriveResolution } from "./helpers";
import type { GateOutcome } from "./types";

// ── GateRunner class ───────────────────────────────────────────────────────

/**
 * Executes permission gate checks for a single gate result (null, bypass, or
 * descriptor).
 *
 * Constructed once per handler with its four role collaborators and reused
 * for every gate in a tool-call pipeline. The `run` method absorbs the null /
 * bypass / descriptor dispatch that previously lived as an anonymous closure
 * in `PermissionGateHandler.handleToolCall`.
 */
export class GateRunner {
  constructor(
    private readonly resolver: ScopedPermissionResolver,
    private readonly recorder: SessionApprovalRecorder,
    private readonly prompter: AskEscalator,
    private readonly reporter: DecisionReporter,
    private readonly autoDecider?: AutoAskDecider,
    private readonly learnedEvaluator?: Pick<
      LearnedGrantEvaluator,
      "evaluateAsk"
    >,
    private readonly evidenceRecorder?: EvidenceRecorder,
  ) {}

  /**
   * Execute a gate: null → allow; bypass → log/emit side effects then allow;
   * descriptor → full check→log→emit→approve cycle.
   */
  async run(
    gate: GateResult,
    agentName: string | null,
    toolCallId: string,
  ): Promise<GateOutcome> {
    return this.runGate(gate, agentName, toolCallId, true, true);
  }

  /** Run automatic authorities quietly, without opening a human prompt. */
  async runAutomatic(
    gate: GateResult,
    agentName: string | null,
    toolCallId: string,
  ): Promise<GateOutcome> {
    return this.runGate(gate, agentName, toolCallId, false, false);
  }

  private async runGate(
    gate: GateResult,
    agentName: string | null,
    toolCallId: string,
    promptOnUnresolvedAsk: boolean,
    reportDecisions: boolean,
  ): Promise<GateOutcome> {
    if (!gate) {
      return { action: "allow" };
    }
    if (isGateBypass(gate)) {
      if (reportDecisions) {
        if (gate.log) {
          this.reporter.writeReviewLog(gate.log.event, gate.log.details);
        }
        if (gate.decision) {
          this.reporter.emitDecision(gate.decision);
        }
      }
      return { action: "allow" };
    }
    return this.runDescriptor(
      gate,
      agentName,
      toolCallId,
      promptOnUnresolvedAsk,
      reportDecisions,
    );
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async runDescriptor(
    descriptor: GateDescriptor,
    agentName: string | null,
    toolCallId: string,
    promptOnUnresolvedAsk: boolean,
    reportDecisions: boolean,
  ): Promise<GateOutcome> {
    // 1. Resolve permission state — pre-check, pre-resolved, or via resolver
    let check: PermissionCheckResult;
    if (descriptor.preCheck) {
      check = descriptor.preCheck;
    } else if (descriptor.preResolved) {
      check = {
        state: descriptor.preResolved.state,
        toolName: descriptor.surface,
        source: "tool",
        origin: "builtin",
      };
    } else {
      check = this.resolver.resolve({
        kind: "tool",
        surface: descriptor.surface,
        input: descriptor.input,
        agentName: agentName ?? undefined,
      });
    }

    // 2. Session-hit fast path
    if (check.source === "session") {
      if (reportDecisions) {
        this.reporter.writeReviewLog("permission_request.session_approved", {
          ...descriptor.logContext,
          agentName,
          resolution: "session_approved",
          sessionApprovalPattern: check.matchedPattern,
        });
        this.reporter.emitDecision(
          buildDecisionEvent(
            descriptor.decision,
            check,
            agentName,
            "allow",
            "session_approved",
          ),
        );
      }
      return { action: "allow" };
    }

    // 2b. Yolo fast-path — a composition-stage ask→allow rewrite records
    // origin "yolo" on the matched rule. Auto-approve without prompting,
    // preserving today's single auto_approved review entry + decision event
    // so review-log parity holds (#526).
    if (check.state === "allow" && check.origin === "yolo") {
      if (reportDecisions) {
        this.reporter.writeReviewLog("permission_request.auto_approved", {
          ...descriptor.logContext,
          agentName,
          resolution: "auto_approved",
        });
        this.reporter.emitDecision(
          buildDecisionEvent(
            descriptor.decision,
            check,
            agentName,
            "allow",
            deriveResolution(check.state, "allow", false, false, true),
            { kind: "auto_mode", detail: "yolo-origin allow" },
          ),
        );
      }
      return { action: "allow" };
    }

    // 3. Apply the deny/ask/allow gate — always escalate on ask; the selected
    // Authorizer answers (the DenyingAuthorizer by denying with a marker).

    // Construct messages from the centralized formatter.
    const messages = {
      denyReason: formatDenyReason(descriptor.denialContext),
      unavailableReason: formatUnavailableReason(descriptor.denialContext),
      userDeniedReason: (decision: PermissionPromptDecision) =>
        formatUserDeniedReason(descriptor.denialContext, decision.denialReason),
    };

    const learnedAttempt = this.tryLearnedDecide(
      descriptor,
      check,
      agentName,
      toolCallId,
      reportDecisions,
    );
    if (learnedAttempt.action === "allow") {
      return { action: "allow" };
    }

    let autoApproved = false;
    let confirmationUnavailable = false;
    let decisionReason: PermissionDecisionReason | null = null;
    const autoAttempt = await this.tryAutoDecide(
      descriptor,
      check,
      agentName,
      toolCallId,
      reportDecisions,
    );
    const autoDecision = autoAttempt.decision;
    if (check.state === "ask" && !autoDecision && !promptOnUnresolvedAsk) {
      if (reportDecisions && autoAttempt.fallbackReason) {
        this.reporter.writeReviewLog("auto_mode.fallback_to_prompt", {
          ...descriptor.logContext,
          agentName,
          reason: autoAttempt.fallbackReason,
        });
      }
      return {
        action: "block",
        reason: "Automatic authorization did not resolve this ask.",
        manualReviewRequired: true,
      };
    }
    const gateResult = await applyPermissionGate({
      state: check.state,
      sessionApproval: descriptor.sessionApproval?.toGateApproval(),
      promptForApproval: async () => {
        if (autoDecision) {
          autoApproved = autoDecision.autoApproved === true;
          confirmationUnavailable =
            autoDecision.confirmationUnavailable === true;
          decisionReason = reasonForAutoDecision(autoDecision);
          return autoDecision;
        }
        if (reportDecisions && autoAttempt.fallbackReason) {
          this.reporter.writeReviewLog("auto_mode.fallback_to_prompt", {
            ...descriptor.logContext,
            agentName,
            reason: autoAttempt.fallbackReason,
          });
        }
        const decision = await this.prompter.escalate({
          requestId: toolCallId,
          ...descriptor.promptDetails,
          ...(descriptor.sessionApproval
            ? {
                sessionApproval: descriptor.sessionApproval.toForwardedData(),
              }
            : {}),
        });
        this.recordPromptEvidence(descriptor, decision, agentName, toolCallId);
        autoApproved = decision.autoApproved === true;
        confirmationUnavailable = decision.confirmationUnavailable === true;
        decisionReason = reasonForPromptDecision(decision);
        return decision;
      },
      writeLog: (event, details) => {
        if (reportDecisions) {
          this.reporter.writeReviewLog(event, details);
        }
      },
      logContext: { ...descriptor.logContext, agentName },
      messages,
    });

    // 4. Determine whether session approval was granted
    const hasSessionApproval =
      gateResult.action === "allow" && gateResult.sessionApproval !== undefined;

    // 5. Emit decision event
    if (reportDecisions) {
      this.reporter.emitDecision(
        buildDecisionEvent(
          descriptor.decision,
          check,
          agentName,
          gateResult.action === "allow" ? "allow" : "deny",
          deriveResolution(
            check.state,
            gateResult.action,
            hasSessionApproval,
            confirmationUnavailable,
            autoApproved,
          ),
          decisionReason,
        ),
      );
    }

    // 6. Record session approval — tell the store; it owns the per-pattern loop
    // hasSessionApproval already implies gateResult.action === "allow"
    if (reportDecisions && hasSessionApproval && descriptor.sessionApproval) {
      this.recorder.recordSessionApproval(descriptor.sessionApproval);
    }

    if (gateResult.action === "block") {
      return {
        action: "block",
        reason: gateResult.reason,
        ...(!promptOnUnresolvedAsk && check.state === "ask"
          ? { manualReviewRequired: true as const }
          : {}),
      };
    }

    return { action: "allow" };
  }

  private recordPromptEvidence(
    descriptor: GateDescriptor,
    decision: PermissionPromptDecision,
    agentName: string | null,
    toolCallId: string,
  ): void {
    if (!this.evidenceRecorder) return;
    this.evidenceRecorder.record({
      toolCallId,
      agentName,
      surface: descriptor.decision.surface,
      value: descriptor.decision.value,
      decision: decision.approved ? "approved" : "denied",
      independentlyUserApproved: decision.approved,
      denialReason: decision.denialReason,
    });
    this.reporter.writeReviewLog("learning.evidence_recorded", {
      ...descriptor.logContext,
      agentName,
      decision: decision.approved ? "approved" : "denied",
      independentlyUserApproved: decision.approved,
    });
  }

  private tryLearnedDecide(
    descriptor: GateDescriptor,
    check: PermissionCheckResult,
    agentName: string | null,
    toolCallId: string,
    reportDecisions: boolean,
  ): { action: "allow" | "miss" } {
    if (check.state !== "ask" || !this.learnedEvaluator)
      return { action: "miss" };
    if (reportDecisions) {
      this.reporter.writeReviewLog("learning.evaluated", {
        ...descriptor.logContext,
        agentName,
        surface: descriptor.surface,
        intentFingerprint:
          descriptor.learning?.intentFingerprint ?? descriptor.decision.value,
      });
    }
    const askCheck = check as PermissionCheckResult & { state: "ask" };
    const result = this.learnedEvaluator.evaluateAsk({
      check: askCheck,
      intentFingerprint:
        descriptor.learning?.intentFingerprint ?? descriptor.decision.value,
      gateSurface: descriptor.surface as "bash" | "path" | "external_directory",
      source: "tool_call",
      agentName,
      toolCallId,
    });
    if (result.action !== "allow") {
      if (reportDecisions) {
        this.reporter.writeReviewLog("learning.missed", {
          ...descriptor.logContext,
          agentName,
          surface: descriptor.surface,
          action: result.action,
        });
      }
      return { action: "miss" };
    }
    if (reportDecisions) {
      this.reporter.writeReviewLog("learning.allowed", {
        ...descriptor.logContext,
        agentName,
        surface: descriptor.surface,
        resolution: "learned_grant",
        learnedGrantId: result.grantId,
      });
      this.reporter.writeReviewLog("permission_request.learned_approved", {
        ...descriptor.logContext,
        agentName,
        resolution: "learned_grant",
        learnedGrantId: result.grantId,
      });
      this.reporter.emitDecision(
        buildDecisionEvent(
          descriptor.decision,
          check,
          agentName,
          "allow",
          "learned_grant",
          { kind: "learned_grant", detail: result.grantId },
        ),
      );
    }
    return { action: "allow" };
  }

  private async tryAutoDecide(
    descriptor: GateDescriptor,
    check: PermissionCheckResult,
    agentName: string | null,
    toolCallId: string,
    reportDecisions: boolean,
  ): Promise<{
    decision: PermissionPromptDecision | null;
    fallbackReason?: string;
  }> {
    if (check.state !== "ask") {
      return { decision: null };
    }
    if (descriptor.autoMode?.classifierApprovable === false) {
      const reason = descriptor.autoMode.reason ?? "not_classifier_approvable";
      if (reportDecisions) {
        this.reporter.writeReviewLog("auto_mode.skipped", {
          ...descriptor.logContext,
          agentName,
          reason,
          classifierApprovable: false,
        });
      }
      return { decision: null, fallbackReason: reason };
    }
    if (!this.autoDecider) {
      if (reportDecisions) {
        this.reporter.writeReviewLog("auto_mode.skipped", {
          ...descriptor.logContext,
          agentName,
          reason: "missing_auto_decider",
        });
      }
      return { decision: null, fallbackReason: "missing_auto_decider" };
    }
    try {
      const decision = await this.autoDecider.decide({
        agentName,
        check,
        input: descriptor.input,
        prompt: descriptor.promptDetails,
        toolCallId,
      });
      if (!decision) {
        if (reportDecisions) {
          this.reporter.writeReviewLog("auto_mode.unresolved", {
            ...descriptor.logContext,
            agentName,
            reason: "no_decision",
          });
        }
        return { decision: null, fallbackReason: "no_decision" };
      }
      return { decision };
    } catch (error) {
      if (reportDecisions) {
        this.reporter.writeReviewLog("auto_mode.unresolved", {
          ...descriptor.logContext,
          agentName,
          reason: "decider_error",
          error: errorMessage(error),
        });
      }
      return { decision: null, fallbackReason: "decider_error" };
    }
  }
}

function reasonForAutoDecision(
  decision: PermissionPromptDecision,
): PermissionDecisionReason {
  return {
    kind: "auto_mode",
    detail: decision.approved ? "classifier_allow" : decision.denialReason,
  };
}

function reasonForPromptDecision(
  decision: PermissionPromptDecision,
): PermissionDecisionReason {
  if (decision.confirmationUnavailable) {
    return { kind: "confirmation_unavailable" };
  }
  return { kind: "manual_prompt", detail: decision.denialReason };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
