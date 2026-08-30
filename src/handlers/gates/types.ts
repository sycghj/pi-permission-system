/** Outcome of a single permission gate evaluation. */
export type GateOutcome =
  | { action: "allow" }
  | {
      action: "block";
      reason: string;
      /** Automatic-only evaluation reached an ask that requires human review. */
      manualReviewRequired?: true;
    };

/** Pre-validated context shared across all gates. */
export interface ToolCallContext {
  toolName: string;
  agentName: string | null;
  input: unknown;
  toolCallId: string;
  cwd: string;
}
