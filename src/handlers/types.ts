import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

import type { PermissionPromptDecision } from "../permission-dialog";
import type { PermissionEventBus } from "../permission-events";
import type {
  PermissionReviewSource,
  PromptPermissionDetails,
} from "../permission-prompter";
import type { PermissionSession } from "../permission-session";

export type {
  PermissionReviewSource,
  PromptPermissionDetails,
} from "../permission-prompter";

/**
 * Explicit dependency bag passed to each extracted event handler.
 *
 * `session` is a `PermissionSession` that encapsulates all mutable state
 * and exposes operations instead of fields — eliminating LoD violations,
 * output arguments, and scattered field resets.
 *
 * Remaining top-level fields are things the session does not own:
 * event bus, RPC cleanup, Pi tool API, and permission request ID generation.
 */
export interface HandlerDeps {
  // ── Session ─────────────────────────────────────────────────────────
  /** Encapsulates all mutable session state and permission operations. */
  readonly session: PermissionSession;

  // ── Event bus ────────────────────────────────────────────────────────
  /** Event bus for emitting permissions:decision broadcast events. */
  readonly events: PermissionEventBus;

  // ── Permission helpers ─────────────────────────────────────────────────
  /** Whether the current context can show an interactive permission prompt. */
  canRequestPermissionConfirmation(ctx: ExtensionContext): boolean;
  /** Prompt the user for a permission decision, log the outcome, and return it. */
  promptPermission(
    ctx: ExtensionContext,
    details: PromptPermissionDetails,
  ): Promise<PermissionPromptDecision>;
  /** Generate a unique ID for a permission request. */
  createPermissionRequestId(prefix: string): string;

  // ── Lifecycle ───────────────────────────────────────────────────────────
  /** Unsubscribe the permissions:rpc:check and permissions:rpc:prompt handlers. */
  stopPermissionRpcHandlers(): void;

  // ── Pi API subset ──────────────────────────────────────────────────────
  getAllTools(): unknown[];
  setActiveTools(names: string[]): void;
}
