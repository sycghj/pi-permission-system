import { createHash } from "node:crypto";

export const MANUAL_APPROVAL_TTL_MS = 5 * 60_000;

export interface ManualApprovalInvocation {
  sessionId: string;
  agentName: string | null;
  toolName: string;
  input: unknown;
}

export interface ConsumedManualApproval {
  toolName: string;
  fingerprint: string;
  approvedAt: number;
}

interface StoredManualApproval extends ConsumedManualApproval {
  key: string;
  expiresAt: number;
}

export interface ManualApprovalStoreOptions {
  now?: () => number;
  ttlMs?: number;
}

/** Stable JSON identity for an arbitrary tool input. */
export function stableToolInput(input: unknown): string {
  return JSON.stringify(sortJsonValue(input));
}

/**
 * In-memory, session-bound one-shot grants for exact tool invocations.
 *
 * Only a SHA-256 fingerprint is suitable for logs; the stable invocation key
 * remains private to this store and is discarded immediately after use.
 */
export class ManualApprovalStore {
  private readonly grants = new Map<string, StoredManualApproval>();
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(options: ManualApprovalStoreOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.ttlMs = options.ttlMs ?? MANUAL_APPROVAL_TTL_MS;
  }

  issue(invocation: ManualApprovalInvocation): ConsumedManualApproval {
    const approvedAt = this.now();
    const key = invocationKey(invocation);
    const grant = {
      key,
      toolName: invocation.toolName,
      fingerprint: manualApprovalFingerprint(invocation),
      approvedAt,
      expiresAt: approvedAt + this.ttlMs,
    };
    this.grants.set(key, grant);
    return publicGrant(grant);
  }

  consume(invocation: ManualApprovalInvocation): ConsumedManualApproval | null {
    const key = invocationKey(invocation);
    const grant = this.grants.get(key);
    if (!grant) {
      return null;
    }
    this.grants.delete(key);
    if (grant.expiresAt <= this.now()) {
      return null;
    }
    return publicGrant(grant);
  }

  clear(): void {
    this.grants.clear();
  }
}

function invocationKey(invocation: ManualApprovalInvocation): string {
  return stableToolInput({
    sessionId: invocation.sessionId,
    agentName: invocation.agentName,
    toolName: invocation.toolName,
    input: invocation.input,
  });
}

export function manualApprovalFingerprint(
  invocation: ManualApprovalInvocation,
): string {
  return createHash("sha256").update(invocationKey(invocation)).digest("hex");
}

function publicGrant(grant: StoredManualApproval): ConsumedManualApproval {
  return {
    toolName: grant.toolName,
    fingerprint: grant.fingerprint,
    approvedAt: grant.approvedAt,
  };
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (value !== null && typeof value === "object") {
    const sorted = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(value).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) {
        sorted[key] = sortJsonValue(child);
      }
    }
    return sorted;
  }
  return value;
}
