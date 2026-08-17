/// <reference path="../../mac-compatibility.d.ts" />

import type { MacCompatibilityStatus } from "./MacCompatibilityCircle";

/**
 * The main process and the circle use different words for the same
 * states, so every value has to be translated in exactly one place.
 *
 * Main process (see src/main/services/mac-compatibility/
 * MacCompatibilityTypes.ts) uses underscores: needs_setup, needs_repair,
 * unsupported. The circle uses hyphens: needs-setup, needs-fix,
 * not-compatible. Without this map the circle silently falls back to
 * "unknown" for every real status.
 *
 * "checking" has no circle equivalent because the circle shows work in
 * progress through its own busy prop, so it maps to "unknown" and the
 * caller passes busy instead.
 */
export const toCircleStatus = (
  status: MacCompatibilityStatusValue | null | undefined
): MacCompatibilityStatus => {
  switch (status) {
    case "ready":
      return "ready";
    case "needs_setup":
      return "needs-setup";
    case "needs_repair":
      return "needs-fix";
    case "unsupported":
    case "error":
      return "not-compatible";
    case "checking":
    case "unknown":
    default:
      return "unknown";
  }
};
