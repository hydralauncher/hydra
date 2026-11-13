import { levelDBService } from "./services/leveldb.service";

const LEVELDB_KEY = "dismissedTips";

export const CLASSICS_ONBOARDING_TIP = "hydra-classics-onboarding-dismissed";
export const RECOMPILATION_ONBOARDING_TIP =
  "hydra-recompilation-onboarding-dismissed";
export const RECOMPILATION_SIDEBAR_TIP = "hydra-recompilation-sidebar-tip-seen";

const LEGACY_RECOMPILATION_SIDEBAR_TIP = "hydra-recompilation-tip-dismissed";

const TIPS = [
  CLASSICS_ONBOARDING_TIP,
  RECOMPILATION_ONBOARDING_TIP,
  RECOMPILATION_SIDEBAR_TIP,
];

export const isTipDismissed = (tip: string) =>
  localStorage.getItem(tip) === "true";

const readSavedTips = async () => {
  const stored = await levelDBService
    .get(LEVELDB_KEY, null, "json")
    .catch(() => null);
  return Array.isArray(stored)
    ? stored.filter((tip): tip is string => typeof tip === "string")
    : [];
};

const migrateLegacyTips = () => {
  const legacy = localStorage.getItem(LEGACY_RECOMPILATION_SIDEBAR_TIP);
  if (legacy === null) return;
  let games: unknown = null;
  try {
    games = JSON.parse(legacy);
  } catch {
    games = null;
  }
  if (Array.isArray(games) && games.length > 0) {
    localStorage.setItem(RECOMPILATION_SIDEBAR_TIP, "true");
  }
  localStorage.removeItem(LEGACY_RECOMPILATION_SIDEBAR_TIP);
};

export const restoreDismissedTips = async () => {
  try {
    migrateLegacyTips();
    const saved = await readSavedTips();
    for (const tip of saved) {
      if (TIPS.includes(tip)) localStorage.setItem(tip, "true");
    }
    const missing = TIPS.filter(
      (tip) => isTipDismissed(tip) && !saved.includes(tip)
    );
    if (missing.length > 0) {
      await levelDBService.put(
        LEVELDB_KEY,
        [...saved, ...missing],
        null,
        "json"
      );
    }
  } catch (error) {
    console.error("Failed to restore dismissed tips", error);
  }
};

export const dismissTip = (tip: string) => {
  localStorage.setItem(tip, "true");
  void readSavedTips()
    .then((saved) =>
      saved.includes(tip)
        ? undefined
        : levelDBService.put(LEVELDB_KEY, [...saved, tip], null, "json")
    )
    .catch((error) => {
      console.error("Failed to save dismissed tip", error);
    });
};
