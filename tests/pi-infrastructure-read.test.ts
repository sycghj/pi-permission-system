import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { discoverGlobalNodeModulesRoot } from "../src/external-directory";

// ── discoverGlobalNodeModulesRoot ──────────────────────────────────────────

describe("discoverGlobalNodeModulesRoot", () => {
  test("returns the node_modules dir when the file is inside one", () => {
    const url =
      "file:///opt/homebrew/lib/node_modules/pi-permission-system/dist/external-directory.js";
    expect(discoverGlobalNodeModulesRoot(url)).toBe(
      "/opt/homebrew/lib/node_modules",
    );
  });

  test("returns node_modules for a deeply nested file", () => {
    const url =
      "file:///home/user/.nvm/versions/node/v20/lib/node_modules/pi-permission-system/src/external-directory.js";
    expect(discoverGlobalNodeModulesRoot(url)).toBe(
      "/home/user/.nvm/versions/node/v20/lib/node_modules",
    );
  });

  test("returns node_modules for a bun global install path", () => {
    const url =
      "file:///home/user/.bun/install/global/node_modules/pi-permission-system/dist/external-directory.js";
    expect(discoverGlobalNodeModulesRoot(url)).toBe(
      "/home/user/.bun/install/global/node_modules",
    );
  });

  test("returns the innermost (closest-to-file) node_modules ancestor", () => {
    // The walk-up algorithm stops at the first node_modules dir it encounters,
    // which is the innermost one when the file is inside a nested install.
    // In practice this never happens for a real global install — the extension
    // is always directly at <global_root>/node_modules/pi-permission-system/…
    const url =
      "file:///opt/lib/node_modules/some-pkg/node_modules/pi-permission-system/dist/index.js";
    expect(discoverGlobalNodeModulesRoot(url)).toBe(
      "/opt/lib/node_modules/some-pkg/node_modules",
    );
  });

  test("returns null when the file is not inside any node_modules directory", () => {
    const url =
      "file:///home/user/development/pi-permission-system/dist/external-directory.js";
    expect(discoverGlobalNodeModulesRoot(url)).toBeNull();
  });

  test("returns null for a root-level file", () => {
    const url = "file:///external-directory.js";
    expect(discoverGlobalNodeModulesRoot(url)).toBeNull();
  });

  test("returns null for an invalid URL", () => {
    expect(discoverGlobalNodeModulesRoot("not-a-url")).toBeNull();
  });

  test("works with the real import.meta.url of this extension (smoke test)", () => {
    // The extension IS installed inside a node_modules tree when running in CI
    // or global install. In a local dev checkout the result may be null — that's
    // the documented graceful-degradation path.
    const result = discoverGlobalNodeModulesRoot();
    expect(result === null || result.endsWith("node_modules")).toBe(true);
  });

  test("the discovered path includes the pi-permission-system package directory", () => {
    const url =
      "file:///opt/homebrew/lib/node_modules/pi-permission-system/dist/external-directory.js";
    const root = discoverGlobalNodeModulesRoot(url);
    expect(root).not.toBeNull();
    expect(join(root!, "pi-permission-system")).toBe(
      "/opt/homebrew/lib/node_modules/pi-permission-system",
    );
  });
});
