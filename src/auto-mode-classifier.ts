import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PermissionPromptDecision } from "#src/authority/permission-dialog";
import type {
  AutoAskDecider,
  AutoAskDecisionRequest,
} from "#src/handlers/gates/auto-ask-decider";
import {
  type AutoModeObserver,
  autoModeEventDetails,
  fallbackEventName,
  ignoreAutoModeEvent,
} from "./auto-mode-observer";
import {
  classifierRequestInit,
  type NormalizedAutoModeConfig,
  parseClassifierResult,
  responseText,
} from "./auto-mode-request";
import { autoModeRuntimeContext } from "./auto-mode-runtime-context";
import { shouldReviewWithSecondStage } from "./auto-mode-two-stage";

type Post = (url: string, init: RequestInit) => Promise<Response>;
type ConfigProvider = () => NormalizedAutoModeConfig;
type ContextProvider = () => ExtensionContext | null;

export class ClassifierAutoAskDecider implements AutoAskDecider {
  constructor(
    private readonly getConfig: ConfigProvider,
    private readonly getContext: ContextProvider,
    private readonly post: Post = fetch,
    private readonly observe: AutoModeObserver = ignoreAutoModeEvent,
  ) {}

  async decide(
    request: AutoAskDecisionRequest,
  ): Promise<PermissionPromptDecision | null> {
    const config = this.getConfig();
    const details = autoModeEventDetails(config, request);
    if (!config.enabled) {
      this.observe("auto_mode.skipped", { ...details, reason: "disabled" });
      return null;
    }

    this.observe("auto_mode.started", details);

    const ctx = this.getContext();
    if (!ctx)
      return setupFallback(config, this.observe, details, "missing_context");

    const model = ctx.modelRegistry.find(config.provider, config.modelId);
    if (!model)
      return setupFallback(config, this.observe, details, "missing_model");

    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok)
      return setupFallback(config, this.observe, details, "missing_auth");

    return decideWithRetries({
      config,
      post: this.post,
      observe: this.observe,
      details,
      url: endpoint(model.baseUrl),
      headers: headers(auth),
      model: model.id,
      request,
      runtime: autoModeRuntimeContext(ctx, request),
    });
  }
}

interface RetryArgs {
  config: NormalizedAutoModeConfig;
  post: Post;
  observe: AutoModeObserver;
  details: Record<string, unknown>;
  url: string;
  headers: Record<string, string>;
  model: string;
  request: AutoAskDecisionRequest;
  runtime?: { cwd?: string; entries?: readonly unknown[] };
  stage?: "primary" | "review";
}

interface InvalidResult {
  kind: "invalid";
}

type ClassifyResult = PermissionPromptDecision | InvalidResult | null;

async function decideWithRetries(
  args: RetryArgs,
): Promise<PermissionPromptDecision | null> {
  const attempts = args.config.maxRetries + 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const decision = await tryClassify(args, attempt);
    if (isInvalidResult(decision)) {
      if (attempt < attempts - 1) {
        args.observe("auto_mode.retry", {
          ...args.details,
          attempt: attempt + 1,
        });
      }
      continue;
    }
    if (decision) {
      emitDecision(args, decision);
      return decision;
    }
    if (attempt < attempts - 1) {
      args.observe("auto_mode.retry", {
        ...args.details,
        attempt: attempt + 1,
      });
    }
  }
  return observedFallback(args.config, args.observe, args.details);
}

async function tryClassify(
  args: RetryArgs,
  attempt: number,
): Promise<ClassifyResult> {
  try {
    const response = await args.post(args.url, requestInit(args, attempt));
    if (!response.ok) {
      args.observe("auto_mode.http_failure", {
        ...args.details,
        attempt,
        status: response.status,
      });
      return null;
    }
    const result = parseClassifierResult(responseText(await response.json()));
    if (
      args.stage !== "review" &&
      shouldReviewWithSecondStage(result, twoStageOptions(args.config))
    ) {
      args.observe("auto_mode.second_stage", { ...args.details, attempt });
      return await tryClassify({ ...args, stage: "review" }, attempt);
    }
    if (result.kind === "invalid") {
      args.observe("auto_mode.parse_failure", { ...args.details, attempt });
      return { kind: "invalid" };
    }
    return result.decision;
  } catch {
    args.observe("auto_mode.http_failure", { ...args.details, attempt });
    return null;
  }
}

function isInvalidResult(value: ClassifyResult): value is InvalidResult {
  return Boolean(value && "kind" in value);
}

function twoStageOptions(config: NormalizedAutoModeConfig): {
  enabled: boolean;
  thinkingBudgetTokens: number;
} {
  return {
    enabled: config.twoStage?.enabled === true,
    thinkingBudgetTokens: config.twoStage?.thinkingBudgetTokens ?? 1024,
  };
}

function requestInit(args: RetryArgs, attempt: number): RequestInit {
  return classifierRequestInit(
    {
      model: args.model,
      config: args.config,
      request: args.request,
      attempt,
      runtime: args.runtime,
      stage: args.stage ?? "primary",
    },
    args.headers,
  );
}

function setupFallback(
  config: NormalizedAutoModeConfig,
  observe: AutoModeObserver,
  details: Record<string, unknown>,
  reason: string,
): PermissionPromptDecision | null {
  observe("auto_mode.setup_failure", { ...details, reason });
  return observedFallback(config, observe, details);
}

function observedFallback(
  config: NormalizedAutoModeConfig,
  observe: AutoModeObserver,
  details: Record<string, unknown>,
): PermissionPromptDecision | null {
  observe(fallbackEventName(config.fallback), details);
  return fallback(config);
}

function emitDecision(
  args: RetryArgs,
  decision: PermissionPromptDecision,
): void {
  if (decision.approved) {
    args.observe("auto_mode.allowed", args.details);
    return;
  }
  args.observe("auto_mode.denied", {
    ...args.details,
    reason: decision.denialReason,
  });
}

function fallback(
  config: NormalizedAutoModeConfig,
): PermissionPromptDecision | null {
  if (config.fallback === "ask") return null;
  return {
    approved: false,
    state: "denied_with_reason",
    denialReason: "Auto mode classifier failed closed.",
  };
}

function endpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/v1/messages`;
}

function headers(auth: {
  apiKey?: string;
  headers?: Record<string, string>;
}): Record<string, string> {
  return {
    "content-type": "application/json",
    "anthropic-version": "2023-06-01",
    ...auth.headers,
    ...(auth.apiKey ? { "x-api-key": auth.apiKey } : {}),
  };
}
