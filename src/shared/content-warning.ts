import type { Game, GameContentWarning } from "@types";
import { SteamContentDescriptor } from "./constants.js";

// Steam gates "Adults Only" storefront listings at 18; used only as the
// informational minimumAge on the derived warning, not as a filtering
// threshold (shouldHideGameForAdultContent keys off `level`, not age).
const STEAM_ADULT_ONLY_MINIMUM_AGE = 18;

export const getSteamContentWarning = (
  ids: number[] | null | undefined
): GameContentWarning => {
  const descriptorIds = ids ?? [];

  if (descriptorIds.includes(SteamContentDescriptor.AdultOnlySexualContent)) {
    return {
      level: "adult",
      minimumAge: STEAM_ADULT_ONLY_MINIMUM_AGE,
      reasons: ["sexual_content"],
      source: "steam",
    };
  }

  if (descriptorIds.length === 0) {
    return { level: "none", minimumAge: null, reasons: [], source: "steam" };
  }

  const reasons: GameContentWarning["reasons"] = [];
  if (
    descriptorIds.includes(SteamContentDescriptor.SomeNudityOrSexualContent) ||
    descriptorIds.includes(SteamContentDescriptor.FrequentNudityOrSexualContent)
  ) {
    reasons.push("nudity");
  }
  if (descriptorIds.includes(SteamContentDescriptor.GeneralMatureContent)) {
    reasons.push("age_restricted");
  }

  // Descriptors with no specific reason mapping (e.g. violence/gore) still
  // mark the game "mature" - reasons just stays empty for those.
  return { level: "mature", minimumAge: null, reasons, source: "steam" };
};

export const shouldHideGameForAdultContent = (
  game: Pick<Game, "contentWarning">,
  hideAdultContent: boolean | undefined
): boolean => {
  if (!hideAdultContent) return false;
  // A game with no contentWarning yet (steam descriptors not classified) is
  // never treated as adult here - getLibrary backfills classification for
  // exactly this case (see classifyPendingSteamContentWarnings) so the gap
  // is transient rather than a permanent bypass.
  return game.contentWarning?.level === "adult";
};
