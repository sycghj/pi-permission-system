import type { PermissionPromptDecision } from "#src/authority/permission-dialog";
import type { ClassifierParseResult } from "./auto-mode-request";

export interface TwoStageReviewOptions {
  enabled: boolean;
  thinkingBudgetTokens: number;
}

export function shouldReviewWithSecondStage(
  result: ClassifierParseResult,
  options: TwoStageReviewOptions,
): boolean {
  if (!options.enabled) return false;
  if (result.kind === "invalid") return true;
  return isDenied(result.decision);
}

function isDenied(decision: PermissionPromptDecision): boolean {
  return !decision.approved;
}
