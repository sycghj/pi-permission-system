import { expect, test } from "vitest";
import { DEFAULT_EXTENSION_CONFIG } from "#src/extension-config";
import { getPermissionSystemStatus } from "#src/status";

test("Permission-system status exposes the active automatic authorization mode", () => {
  expect(getPermissionSystemStatus(DEFAULT_EXTENSION_CONFIG)).toBe(undefined);
  expect(
    getPermissionSystemStatus({
      ...DEFAULT_EXTENSION_CONFIG,
      autoMode: { ...DEFAULT_EXTENSION_CONFIG.autoMode, enabled: true },
    }),
  ).toBe("auto");
  expect(
    getPermissionSystemStatus({
      ...DEFAULT_EXTENSION_CONFIG,
      yoloMode: true,
      autoMode: { ...DEFAULT_EXTENSION_CONFIG.autoMode, enabled: true },
    }),
  ).toBe("yolo");
});
