import type {
  GateSurface,
  RequestSource,
  SessionLearningStore,
} from "#src/learning/session-learning-store";

export interface AskPermissionCheck {
  readonly state: "ask";
}

export interface EvaluationRequest {
  readonly check: { readonly state: string };
  readonly intentFingerprint: string;
  readonly gateSurface: GateSurface;
  readonly source: RequestSource;
  readonly agentName: string | null;
  readonly toolCallId: string;
}

export type LearnedEvaluation =
  | {
      readonly action: "allow";
      readonly grantId: string;
      readonly reservationId: string;
    }
  | { readonly action: "miss" };

export class LearnedGrantEvaluator {
  constructor(private readonly store: SessionLearningStore) {}

  evaluateAsk(
    request: EvaluationRequest & { readonly check: AskPermissionCheck },
  ): LearnedEvaluation {
    const reservation = this.store.reserveMatch(request);
    if (!reservation) return { action: "miss" };
    return {
      action: "allow",
      grantId: reservation.grantId,
      reservationId: reservation.reservationId,
    };
  }

  evaluate(request: EvaluationRequest): LearnedEvaluation {
    if (request.check.state !== "ask") {
      throw new Error("Learned grants can only evaluate ask checks.");
    }
    return this.evaluateAsk(
      request as EvaluationRequest & { check: AskPermissionCheck },
    );
  }
}
