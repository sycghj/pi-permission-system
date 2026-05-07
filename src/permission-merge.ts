import type { FlatPermissionConfig, PermissionState } from "./types";

/**
 * Deep-shallow merge two flat permission configs.
 * Both objects → shallow-merge the pattern maps.
 * Otherwise → override replaces base.
 */
export function mergeFlatPermissions(
  base: FlatPermissionConfig,
  override: FlatPermissionConfig,
): FlatPermissionConfig {
  const merged: FlatPermissionConfig = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const baseVal = merged[key];
    if (
      typeof baseVal === "object" &&
      baseVal !== null &&
      typeof value === "object" &&
      value !== null
    ) {
      merged[key] = {
        ...(baseVal as Record<string, PermissionState>),
        ...(value as Record<string, PermissionState>),
      };
    } else {
      merged[key] = value;
    }
  }
  return merged;
}
