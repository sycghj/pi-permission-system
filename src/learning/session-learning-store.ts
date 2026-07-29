export type GrantStatus = "active" | "revoked" | "expired";
export type GateSurface = "bash" | "path" | "external_directory";
export type RequestSource = "tool_call" | "user_bash";

export interface LearnedGrant {
  readonly id: string;
  readonly status: GrantStatus;
  readonly matcher: {
    readonly kind: "exact";
    readonly intentFingerprint: string;
  };
  readonly scope: {
    readonly sources: readonly RequestSource[];
    readonly agents: readonly string[];
  };
  readonly coveredGateSurfaces: readonly GateSurface[];
  readonly expiresAt: number;
  readonly maxUses: number;
  readonly committedUses: number;
  readonly reservedUses: number;
  readonly revocationReason?: string;
}

export interface MatchRequest {
  readonly intentFingerprint: string;
  readonly gateSurface: GateSurface;
  readonly source: RequestSource;
  readonly agentName: string | null;
  readonly toolCallId: string;
}

export interface GrantReservation {
  readonly reservationId: string;
  readonly grantId: string;
}

export interface StoreOptions {
  readonly now: () => number;
}

export class SessionLearningStore {
  private readonly grants = new Map<string, LearnedGrant>();
  private readonly reservations = new Map<string, string>();
  private nextReservation = 1;

  constructor(private readonly options: StoreOptions) {}

  createGrant(grant: LearnedGrant): void {
    this.grants.set(grant.id, { ...grant });
  }

  reserveMatch(request: MatchRequest): GrantReservation | null {
    const grant = this.matchingGrant(request);
    if (!grant) return null;
    if (remainingUses(grant) <= 0) return null;

    const reservationId = `lr-${this.nextReservation}`;
    this.nextReservation += 1;
    this.reservations.set(reservationId, grant.id);
    this.grants.set(grant.id, reserveUse(grant));
    return { reservationId, grantId: grant.id };
  }

  commitReservation(reservationId: string): void {
    const grant = this.reservedGrant(reservationId);
    if (!grant) return;
    this.grants.set(grant.id, commitUse(grant));
    this.reservations.delete(reservationId);
  }

  abortReservation(reservationId: string): void {
    const grant = this.reservedGrant(reservationId);
    if (!grant) return;
    this.grants.set(grant.id, abortUse(grant));
    this.reservations.delete(reservationId);
  }

  explain(intentFingerprint: string): {
    matched: boolean;
    reason?: string;
    grantId?: string;
    remainingUses?: number;
    expiresAt?: number;
    revocationReason?: string;
  } {
    const grant = [...this.grants.values()].find(
      (item) => item.matcher.intentFingerprint === intentFingerprint,
    );
    if (!grant) return { matched: false, reason: "no-match" };
    if (grant.status === "revoked") {
      return {
        matched: false,
        reason: "revoked",
        grantId: grant.id,
        revocationReason: grant.revocationReason,
      };
    }
    if (this.isExpired(grant)) {
      return { matched: false, reason: "expired", grantId: grant.id };
    }
    if (remainingUses(grant) <= 0) {
      return {
        matched: false,
        reason: "use-limit-exhausted",
        grantId: grant.id,
      };
    }
    return {
      matched: true,
      grantId: grant.id,
      remainingUses: remainingUses(grant),
      expiresAt: grant.expiresAt,
    };
  }

  revoke(grantId: string, reason: string): boolean {
    const grant = this.grants.get(grantId);
    if (!grant) return false;
    this.grants.set(grantId, {
      ...grant,
      status: "revoked",
      revocationReason: reason,
    });
    return true;
  }

  private matchingGrant(request: MatchRequest): LearnedGrant | undefined {
    return [...this.grants.values()].find((grant) =>
      this.matches(grant, request),
    );
  }

  private matches(grant: LearnedGrant, request: MatchRequest): boolean {
    if (grant.status !== "active" || this.isExpired(grant)) return false;
    if (grant.matcher.intentFingerprint !== request.intentFingerprint)
      return false;
    if (!grant.coveredGateSurfaces.includes(request.gateSurface)) return false;
    if (!grant.scope.sources.includes(request.source)) return false;
    return (
      request.agentName !== null &&
      grant.scope.agents.includes(request.agentName)
    );
  }

  private reservedGrant(reservationId: string): LearnedGrant | undefined {
    const grantId = this.reservations.get(reservationId);
    return grantId ? this.grants.get(grantId) : undefined;
  }

  private isExpired(grant: LearnedGrant): boolean {
    return this.options.now() >= grant.expiresAt;
  }
}

function remainingUses(grant: LearnedGrant): number {
  return grant.maxUses - grant.committedUses - grant.reservedUses;
}

function reserveUse(grant: LearnedGrant): LearnedGrant {
  return { ...grant, reservedUses: grant.reservedUses + 1 };
}

function commitUse(grant: LearnedGrant): LearnedGrant {
  return {
    ...grant,
    committedUses: grant.committedUses + 1,
    reservedUses: Math.max(0, grant.reservedUses - 1),
  };
}

function abortUse(grant: LearnedGrant): LearnedGrant {
  return { ...grant, reservedUses: Math.max(0, grant.reservedUses - 1) };
}
