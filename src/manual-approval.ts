import { Type } from "@earendil-works/pi-ai";
import {
  defineTool,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { HumanOnlyAskEscalator } from "#src/authority/authorizer-selection";
import type { PermissionSystemExtensionConfig } from "#src/extension-config";
import type { GateOutcome, ToolCallContext } from "#src/handlers/gates/types";
import type { ManualApprovalGate } from "#src/handlers/permission-gate-handler";
import {
  type ManualApprovalStore,
  manualApprovalFingerprint,
  stableToolInput,
} from "#src/manual-approval-store";
import type { ReviewLogger } from "#src/session-logger";
import {
  checkRequestedToolRegistration,
  type ToolRegistry,
} from "#src/tool-registry";
import { toRecord } from "#src/value-guards";

export const MANUAL_APPROVAL_TOOL_NAME = "request_tool_approval";

export const manualApprovalToolParameters = Type.Object({
  toolName: Type.String({
    minLength: 1,
    description: "Exact registered tool name to call after approval.",
  }),
  input: Type.Record(Type.String(), Type.Unknown(), {
    description:
      "Complete structured input object for the future tool call. It must match exactly.",
  }),
  reason: Type.String({
    minLength: 1,
    description: "Why this tool call is necessary.",
  }),
});

export interface ManualApprovalRequest {
  toolName: string;
  input: unknown;
  reason: string;
}

export interface DenyFloorEvaluator {
  evaluateDenyFloor(tcc: ToolCallContext): Promise<GateOutcome>;
}

export interface AutomaticApprovalEvaluator {
  evaluateAutomatic(
    tcc: ToolCallContext,
    options: { useAutoMode: boolean },
  ): Promise<GateOutcome>;
}

interface ManualApprovalServiceDeps {
  store: ManualApprovalStore;
  denyFloor: DenyFloorEvaluator;
  automatic: AutomaticApprovalEvaluator;
  escalator: HumanOnlyAskEscalator;
  toolRegistry: ToolRegistry;
  getConfig: () => PermissionSystemExtensionConfig;
  resolveAgentName: (ctx: ExtensionContext) => string | null;
  logger: ReviewLogger;
}

/** Coordinates automatic/human approval and execution-time one-shot use. */
export class ManualApprovalService implements ManualApprovalGate {
  readonly toolName = MANUAL_APPROVAL_TOOL_NAME;
  private readonly pending = new Map<string, string | null>();

  constructor(private readonly deps: ManualApprovalServiceDeps) {}

  isEnabled(): boolean {
    return this.deps.getConfig().manualApproval.enabled;
  }

  noteRequest(
    input: unknown,
    agentName: string | null,
    sessionId: string,
    messageId: string | null,
  ): void {
    const record = toRecord(input);
    if (typeof record.toolName !== "string" || record.input === undefined) {
      return;
    }
    this.pending.set(
      pendingKey(sessionId, agentName, record.toolName.trim(), record.input),
      messageId,
    );
  }

  async request(
    toolCallId: string,
    request: ManualApprovalRequest,
    ctx: ExtensionContext,
  ): Promise<{
    approved: boolean;
    message: string;
    fingerprint?: string;
  }> {
    const agentName = this.deps.resolveAgentName(ctx);
    const sessionId = ctx.sessionManager.getSessionId();
    if (!this.isEnabled()) {
      return {
        approved: false,
        message: "One-shot manual approval is disabled by configuration.",
      };
    }
    const targetToolName = request.toolName.trim();
    if (!request.reason.trim()) {
      return {
        approved: false,
        message: "A non-empty rationale is required.",
      };
    }
    if (targetToolName === MANUAL_APPROVAL_TOOL_NAME) {
      return {
        approved: false,
        message: "The approval tool cannot authorize itself.",
      };
    }
    const registration = checkRequestedToolRegistration(
      targetToolName,
      this.deps.toolRegistry.getAll(),
    );
    if (registration.status !== "registered") {
      return {
        approved: false,
        message: `Cannot authorize unregistered tool '${targetToolName}'.`,
      };
    }

    const tcc: ToolCallContext = {
      toolName: targetToolName,
      agentName,
      input: request.input,
      toolCallId,
      cwd: ctx.cwd,
    };
    const invocation = {
      sessionId,
      agentName,
      toolName: targetToolName,
      input: request.input,
    };
    const auditFingerprint = manualApprovalFingerprint(invocation);
    const floor = await this.deps.denyFloor.evaluateDenyFloor(tcc);
    if (floor.action === "block") {
      this.deps.logger.review("manual_approval.policy_denied", {
        requestId: toolCallId,
        toolName: targetToolName,
        agentName,
        fingerprint: auditFingerprint,
      });
      return {
        approved: false,
        message: `Authorization cannot override policy deny: ${floor.reason}`,
      };
    }

    const automatic = await this.deps.automatic.evaluateAutomatic(tcc, {
      useAutoMode: this.deps.getConfig().manualApproval.useAutoMode,
    });
    if (automatic.action === "allow") {
      return this.issueGrant(invocation, toolCallId, "Automatically approved");
    }
    if (automatic.manualReviewRequired !== true) {
      this.deps.logger.review("manual_approval.automatic_denied", {
        requestId: toolCallId,
        toolName: targetToolName,
        agentName,
        fingerprint: auditFingerprint,
      });
      return {
        approved: false,
        message: `Authorization denied: ${automatic.reason}`,
      };
    }

    const stableInput = stableToolInput(request.input);
    const displayInput = prettyJson(stableInput);
    const decision = await this.deps.escalator.escalateHumanOnly({
      requestId: toolCallId,
      source: "tool_call",
      agentName,
      toolName: targetToolName,
      message: [
        "Automatic authorization did not allow this exact invocation. Approve it once?",
        "",
        `Tool: ${targetToolName}`,
        "Input:",
        displayInput,
        "",
        "Agent-provided rationale (untrusted):",
        request.reason.trim(),
        "",
        "Any parameter change requires a new approval.",
      ].join("\n"),
      toolInputPreview: displayInput,
      auditFingerprint,
      humanOnly: true,
    });
    if (!decision.approved) {
      return {
        approved: false,
        message: decision.confirmationUnavailable
          ? "Live human confirmation is unavailable; no approval was issued."
          : decision.denialReason
            ? `User denied this invocation: ${decision.denialReason}`
            : "User denied this invocation.",
      };
    }

    return this.issueGrant(invocation, toolCallId, "Approved");
  }

  async authorizeIfGranted(
    tcc: ToolCallContext,
    sessionId: string,
    messageId: string | null,
  ): Promise<GateOutcome | null> {
    if (!this.isEnabled()) {
      return null;
    }
    const key = pendingKey(sessionId, tcc.agentName, tcc.toolName, tcc.input);
    if (this.pending.has(key)) {
      if (this.pending.get(key) === messageId) {
        return {
          action: "block",
          reason:
            "The approval request and target call cannot be siblings in the same assistant message. In your next model step, retry the exact target call automatically; do not ask the user to reply or confirm again.",
        };
      }
      this.pending.delete(key);
    }
    const grant = this.deps.store.consume({
      sessionId,
      agentName: tcc.agentName,
      toolName: tcc.toolName,
      input: tcc.input,
    });
    if (!grant) {
      return null;
    }

    const floor = await this.deps.denyFloor.evaluateDenyFloor(tcc);
    this.deps.logger.review(
      floor.action === "block"
        ? "manual_approval.grant_blocked_by_policy"
        : "manual_approval.grant_consumed",
      {
        sessionId,
        agentName: tcc.agentName,
        toolName: tcc.toolName,
        toolCallId: tcc.toolCallId,
        fingerprint: grant.fingerprint,
      },
    );
    return floor;
  }

  clear(): void {
    this.pending.clear();
    this.deps.store.clear();
  }

  private issueGrant(
    invocation: {
      sessionId: string;
      agentName: string | null;
      toolName: string;
      input: unknown;
    },
    requestId: string,
    outcome: string,
  ): { approved: true; message: string; fingerprint: string } {
    const grant = this.deps.store.issue(invocation);
    this.deps.logger.review("manual_approval.grant_issued", {
      requestId,
      sessionId: invocation.sessionId,
      agentName: invocation.agentName,
      toolName: invocation.toolName,
      fingerprint: grant.fingerprint,
    });
    return {
      approved: true,
      fingerprint: grant.fingerprint,
      message:
        `${outcome} once for '${invocation.toolName}'. ` +
        "In your next model step, immediately call the target tool with exactly the approved input. " +
        "Continue autonomously; do not ask the user to reply, say 'continue', or confirm again.",
    };
  }
}

export function registerManualApprovalTool(
  pi: ExtensionAPI,
  service: ManualApprovalService,
): void {
  pi.registerTool(
    defineTool({
      name: MANUAL_APPROVAL_TOOL_NAME,
      label: "Request Tool Approval",
      description:
        "Request approval for one exact tool invocation. The permission system first runs normal policy and, when configured, Auto Mode; automatic approval does not open a human dialog, while an unresolved ask or Auto Mode denial is sent for direct human review. " +
        "Call this tool by itself; do not place the target call in the same assistant message. " +
        "If approved automatically or by the human, call the target tool with exactly the same input in your next model step. " +
        "Continue autonomously without asking the user to reply, say 'continue', or confirm again. " +
        "This never overrides a deterministic deny.",
      parameters: manualApprovalToolParameters,
      async execute(toolCallId, params, _signal, _onUpdate, ctx) {
        const result = await service.request(toolCallId, params, ctx);
        return {
          content: [{ type: "text", text: result.message }],
          details: {
            approved: result.approved,
            toolName: params.toolName,
            fingerprint: result.fingerprint,
          },
        };
      },
    }),
  );
}

function pendingKey(
  sessionId: string,
  agentName: string | null,
  toolName: string,
  input: unknown,
): string {
  return stableToolInput({ sessionId, agentName, toolName, input });
}

function prettyJson(stableInput: string): string {
  return JSON.stringify(JSON.parse(stableInput) as unknown, null, 2);
}
