import type { PermissionPromptDecision } from "#src/authority/permission-dialog";
import type { PromptPermissionDetails } from "#src/authority/permission-prompter";
import type { PermissionCheckResult } from "#src/types";

export interface AutoAskDecisionRequest {
  agentName: string | null;
  check: PermissionCheckResult;
  input: unknown;
  prompt: Omit<PromptPermissionDetails, "requestId">;
  toolCallId: string;
}

export interface AutoAskDecider {
  decide(
    request: AutoAskDecisionRequest,
  ): Promise<PermissionPromptDecision | null>;
}
