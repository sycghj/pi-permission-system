export type EvidenceDecision = "approved" | "denied";

export interface EvidenceRecord {
  readonly toolCallId: string;
  readonly agentName: string | null;
  readonly surface: string;
  readonly value: string;
  readonly decision: EvidenceDecision;
  readonly independentlyUserApproved: boolean;
  readonly denialReason?: string;
}

export interface EvidenceRecorder {
  record(evidence: EvidenceRecord): void;
}

export class InMemoryEvidenceRecorder implements EvidenceRecorder {
  private readonly records: EvidenceRecord[] = [];

  record(evidence: EvidenceRecord): void {
    this.records.push({ ...evidence });
  }

  entries(): EvidenceRecord[] {
    return this.records.map((entry) => ({ ...entry }));
  }
}
