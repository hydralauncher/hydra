export type CollapsibleSettingsSection =
  | "retroachievements"
  | "realDebrid"
  | "premiumize"
  | "allDebrid"
  | "torbox";

type CollapsedSections = Partial<Record<CollapsibleSettingsSection, boolean>>;

const COLLAPSED_SECTIONS_STORAGE_KEY = "settings-collapsed-sections";

const readCollapsedSections = (): CollapsedSections => {
  const stored = localStorage.getItem(COLLAPSED_SECTIONS_STORAGE_KEY);
  if (!stored) return {};

  try {
    const parsed = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return parsed as CollapsedSections;
  } catch {
    return {};
  }
};

export const readStoredSectionCollapsed = (
  section: CollapsibleSettingsSection,
  fallback: boolean
): boolean => readCollapsedSections()[section] ?? fallback;

export const storeSectionCollapsed = (
  section: CollapsibleSettingsSection,
  isCollapsed: boolean
) => {
  localStorage.setItem(
    COLLAPSED_SECTIONS_STORAGE_KEY,
    JSON.stringify({ ...readCollapsedSections(), [section]: isCollapsed })
  );
};
