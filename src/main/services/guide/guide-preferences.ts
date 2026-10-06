/**
 * Reading of the persisted "global Guide button" preference.
 *
 * This lives on its own so that the check can be unit tested without pulling in
 * Electron, the native addon or the window manager.
 */

/**
 * Strict reading of the preference.
 *
 * A merely *truthy* value — the string `"true"` written by an older or synced
 * profile, for instance — must never switch on a global input hook, so only the
 * boolean `true` counts.
 */
export const isGlobalGuideButtonEnabled = (
  preferences: { enableGlobalGuideButton?: boolean } | null | undefined
): boolean => preferences?.enableGlobalGuideButton === true;
