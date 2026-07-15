import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PermissionPromptDecision } from "#src/authority/permission-dialog";
import {
  type Authorizer,
  type AuthorizerSelectionDeps,
  selectAuthorizer,
} from "./authorizer";
import type {
  PermissionPrompterApi,
  PromptPermissionDetails,
} from "./permission-prompter";

/**
 * The lifecycle slice of the selection owner that PermissionSession drives.
 *
 * PermissionSession calls activate/deactivate to keep the selection's stored
 * context in sync with its own — the same pattern the former
 * PromptingGatewayLifecycle used.
 */
export interface AuthorizerSelectionLifecycle {
  activate(ctx: ExtensionContext): void;
  deactivate(): void;
}

/**
 * The ask-escalation seam `GateRunner` depends on: escalate a single ask to
 * the session's selected `Authorizer` and return its decision.
 *
 * Replaces the two-method `GatePrompter` role (#556). There is no
 * "can anyone answer" pre-check: absent authority is the `DenyingAuthorizer`,
 * which answers by denying with a `confirmationUnavailable` marker.
 */
export interface AskEscalator {
  escalate(details: PromptPermissionDetails): Promise<PermissionPromptDecision>;
}

/**
 * Context-owning selection root for the Authorizer spine.
 *
 * The rewrite of `PromptingGateway`: owns the stored `ExtensionContext`, runs
 * `selectAuthorizer` once per activation, and implements `AskEscalator` by
 * delegating to the selected `Authorizer` via `PermissionPrompter`.
 *
 * `selectAuthorizer` encodes the liveness decision in *which* `Authorizer` it
 * returns (`LocalUserAuthorizer` / `ParentAuthorizer` when authority is
 * reachable, `DenyingAuthorizer` otherwise), so no separate confirmability
 * predicate survives (#556 dissolved `canConfirm()`).
 */
export class AuthorizerSelection
  implements AskEscalator, AuthorizerSelectionLifecycle
{
  private selected: Authorizer | null = null;

  constructor(
    private readonly deps: AuthorizerSelectionDeps & {
      prompter: PermissionPrompterApi;
    },
  ) {}

  /** Select the Authorizer for `ctx` and store it. */
  activate(ctx: ExtensionContext): void {
    this.selected = selectAuthorizer(ctx, this.deps);
  }

  /** Clear the stored selection. */
  deactivate(): void {
    this.selected = null;
  }

  /**
   * Escalate an ask to the selected authorizer and return its decision.
   *
   * Rejects if no authorizer has been selected — i.e. before the session was
   * activated. Implements {@link AskEscalator}.
   */
  escalate(
    details: PromptPermissionDetails,
  ): Promise<PermissionPromptDecision> {
    if (this.selected === null) {
      return Promise.reject(
        new Error("escalate called before the session was activated"),
      );
    }
    return this.deps.prompter.prompt(this.selected, details);
  }
}
