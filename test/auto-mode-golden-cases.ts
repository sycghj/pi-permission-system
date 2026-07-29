import { destructiveGoldenCases } from "./auto-mode-golden-destructive-cases";
import { gitNetworkGoldenCases } from "./auto-mode-golden-git-network-cases";
import { intentSystemGoldenCases } from "./auto-mode-golden-intent-system-cases";
import { safeGoldenCases } from "./auto-mode-golden-safe-cases";
import { sensitiveGoldenCases } from "./auto-mode-golden-sensitive-cases";
import type { GoldenAutoModeCase } from "./auto-mode-golden-types";

export type { GoldenAutoModeCase } from "./auto-mode-golden-types";

export const goldenAutoModeCases: readonly GoldenAutoModeCase[] = [
  ...safeGoldenCases,
  ...sensitiveGoldenCases,
  ...destructiveGoldenCases,
  ...gitNetworkGoldenCases,
  ...intentSystemGoldenCases,
];
