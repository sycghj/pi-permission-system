import type { AutoModeConfig } from "#src/config-loader";
import type { AutoAskDecisionRequest } from "#src/handlers/gates/auto-ask-decider";

type AutoModeEventConfig = Required<Omit<AutoModeConfig, "twoStage">>;

export type AutoModeEventName =
  | "auto_mode.started"
  | "auto_mode.skipped"
  | "auto_mode.retry"
  | "auto_mode.allowed"
  | "auto_mode.denied"
  | "auto_mode.second_stage"
  | "auto_mode.ask"
  | "auto_mode.fallback_ask"
  | "auto_mode.fallback_deny"
  | "auto_mode.setup_failure"
  | "auto_mode.http_failure"
  | "auto_mode.parse_failure";

export type AutoModeObserver = (
  event: AutoModeEventName,
  details: Record<string, unknown>,
) => void;

export const ignoreAutoModeEvent: AutoModeObserver = () => undefined;

export function autoModeEventDetails(
  config: AutoModeEventConfig,
  request: AutoAskDecisionRequest,
): Record<string, unknown> {
  return {
    provider: config.provider,
    modelId: config.modelId,
    toolCallId: request.toolCallId,
    toolName: request.prompt.toolName,
    source: request.prompt.source,
    agentName: request.agentName,
  };
}

export function fallbackEventName(
  fallback: AutoModeEventConfig["fallback"],
): "auto_mode.fallback_ask" | "auto_mode.fallback_deny" {
  return fallback === "ask"
    ? "auto_mode.fallback_ask"
    : "auto_mode.fallback_deny";
}
