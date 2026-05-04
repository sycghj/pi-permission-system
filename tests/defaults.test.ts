// defaults.ts has been removed as part of #66 (flat permission config format).
// The PermissionDefaultPolicy type and mergeDefaults() / getSurfaceDefault()
// helpers are no longer needed — the universal default is expressed as
// permission["*"] in the flat config, and per-surface catch-alls are regular
// config rules produced by normalizeFlatConfig().
import { describe, expect, test } from "vitest";

describe("defaults (removed)", () => {
  test("placeholder — defaults.ts was removed in #66", () => {
    expect(true).toBe(true);
  });
});
