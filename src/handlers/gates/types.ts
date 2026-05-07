import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

import type { PermissionPromptDecision } from "../../permission-dialog";
import type { PermissionDecisionEvent } from "../../permission-events";
import type { Rule } from "../../rule";
import type { SkillPromptEntry } from "../../skill-prompt-sanitizer";
import type { PermissionCheckResult } from "../../types";
import type { PromptPermissionDetails } from "../types";

/** Outcome of a single permission gate evaluation. */
export type GateOutcome =
  | { action: "allow" }
  | { action: "block"; reason: string };

/** Pre-validated context shared across all gates. */
export interface ToolCallContext {
  toolName: string;
  agentName: string | null;
  input: unknown;
  toolCallId: string;
  cwd: string | undefined;
}

// ── Per-gate narrow dependency interfaces ──────────────────────────────────

/** Narrow deps for evaluateToolGate — every field is a leaf method. */
export interface ToolGateDeps {
  checkPermission(
    surface: string,
    input: unknown,
    agentName?: string,
    sessionRules?: Rule[],
  ): PermissionCheckResult;
  getSessionRuleset(): Rule[];
  approveSessionRule(surface: string, pattern: string): void;
  writeReviewLog(event: string, details: Record<string, unknown>): void;
  emitDecision(event: PermissionDecisionEvent): void;
  canConfirm(): boolean;
  promptPermission(
    details: PromptPermissionDetails,
  ): Promise<PermissionPromptDecision>;
}

/** Narrow deps for evaluateExternalDirectoryGate. */
export interface ExternalDirectoryGateDeps {
  checkPermission(
    surface: string,
    input: unknown,
    agentName?: string,
    sessionRules?: Rule[],
  ): PermissionCheckResult;
  getSessionRuleset(): Rule[];
  approveSessionRule(surface: string, pattern: string): void;
  writeReviewLog(event: string, details: Record<string, unknown>): void;
  emitDecision(event: PermissionDecisionEvent): void;
  canConfirm(): boolean;
  promptPermission(
    details: PromptPermissionDetails,
  ): Promise<PermissionPromptDecision>;
  /** Resolved infrastructure dirs (static + config-based). */
  getInfrastructureDirs(): string[];
}

/** Narrow deps for evaluateBashExternalDirectoryGate. */
export interface BashExternalDirectoryGateDeps {
  checkPermission(
    surface: string,
    input: unknown,
    agentName?: string,
    sessionRules?: Rule[],
  ): PermissionCheckResult;
  getSessionRuleset(): Rule[];
  approveSessionRule(surface: string, pattern: string): void;
  writeReviewLog(event: string, details: Record<string, unknown>): void;
  canConfirm(): boolean;
  promptPermission(
    details: PromptPermissionDetails,
  ): Promise<PermissionPromptDecision>;
}

/** Narrow deps for evaluateSkillReadGate. */
export interface SkillReadGateDeps {
  getActiveSkillEntries(): SkillPromptEntry[];
  writeReviewLog(event: string, details: Record<string, unknown>): void;
  emitDecision(event: PermissionDecisionEvent): void;
  canConfirm(): boolean;
  promptPermission(
    details: PromptPermissionDetails,
  ): Promise<PermissionPromptDecision>;
  createRequestId(prefix: string): string;
}
