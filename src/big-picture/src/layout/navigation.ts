import type { FocusOverrideTarget } from "../services";
import { DOWNLOADS_PAGE_REGION_ID } from "../components/pages/downloads/navigation";
import { GAME_PAGE_REGION_ID } from "../components/pages/game/navigation";
import { CATALOGUE_GRID_REGION_ID } from "../pages/catalogue/navigation";
import { HOME_PAGE_REGION_ID } from "../pages/home/navigation";
import { PROFILE_PAGE_REGION_ID } from "../pages/profile/navigation";
import { SETTINGS_PAGE_REGION_ID } from "../pages/settings/navigation";
import { LIBRARY_PAGE_REGION_ID } from "../components/pages/library/navigation";

export const BIG_PICTURE_APP_LAYER_ID = "big-picture-app-layer";
export const BIG_PICTURE_SHELL_REGION_ID = "big-picture-shell";
export const BIG_PICTURE_SIDEBAR_REGION_ID = "big-picture-sidebar";
export const BIG_PICTURE_CONTENT_REGION_ID = "big-picture-content";
export const BIG_PICTURE_HEADER_REGION_ID = "header";

export const BIG_PICTURE_SIDEBAR_ITEM_IDS = {
  home: "big-picture-sidebar-home",
  catalogue: "big-picture-sidebar-catalogue",
  library: "big-picture-sidebar-library",
  downloads: "big-picture-sidebar-downloads",
  settings: "big-picture-sidebar-settings",
  componentLab: "big-picture-sidebar-component-lab",
} as const;

export const BIG_PICTURE_SIDEBAR_EXIT_ID = "big-picture-sidebar-exit";
export const BIG_PICTURE_SIDEBAR_PROFILE_ID = "big-picture-sidebar-profile";
export const BIG_PICTURE_SIDEBAR_NOTIFICATIONS_ID =
  "big-picture-sidebar-notifications";
export const BIG_PICTURE_SIDEBAR_LIBRARY_SEARCH_ID =
  "big-picture-sidebar-library-search";
export const BIG_PICTURE_SIDEBAR_LIBRARY_LIST_REGION_ID =
  "big-picture-sidebar-library-list";
export const BIG_PICTURE_SIDEBAR_LIBRARY_FILTER_ALL_ID =
  "big-picture-sidebar-library-filter-all";
export const BIG_PICTURE_SIDEBAR_LIBRARY_FILTER_READY_TO_PLAY_ID =
  "big-picture-sidebar-library-filter-ready-to-play";
export const BIG_PICTURE_SIDEBAR_LIBRARY_FILTER_RECENTLY_PLAYED_ID =
  "big-picture-sidebar-library-filter-recently-played";
export const BIG_PICTURE_SIDEBAR_LIBRARY_FILTER_FAVORITES_ID =
  "big-picture-sidebar-library-filter-favorites";

export type BigPictureSidebarRouteKey =
  keyof typeof BIG_PICTURE_SIDEBAR_ITEM_IDS;

export interface BigPictureGameRouteMatch {
  shop: string;
  objectId: string;
}

export function getBigPictureSidebarLibraryGameFocusId(
  game: BigPictureGameRouteMatch
) {
  return `big-picture-sidebar-library-game:${game.shop}:${game.objectId}`;
}

export function normalizeBigPicturePathname(pathname: string) {
  let end = pathname.length;
  while (end > 0 && pathname[end - 1] === "/") end--;
  const withoutTrailingSlash = end === 0 ? "/" : pathname.slice(0, end);

  if (withoutTrailingSlash === "/big-picture") return "/";

  if (withoutTrailingSlash.startsWith("/big-picture/")) {
    return withoutTrailingSlash.slice("/big-picture".length) || "/";
  }

  return withoutTrailingSlash;
}

export function getBigPictureGameRouteMatch(
  pathname: string
): BigPictureGameRouteMatch | null {
  const normalizedPathname = normalizeBigPicturePathname(pathname);
  const match = normalizedPathname.match(/^\/game\/([^/]+)\/([^/]+)$/);

  if (!match) return null;

  return {
    shop: decodeURIComponent(match[1]),
    objectId: decodeURIComponent(match[2]),
  };
}

export function getBigPictureSidebarItemIdFromPathname(pathname: string) {
  const normalizedPathname = normalizeBigPicturePathname(pathname);
  const isDev = import.meta.env.DEV;

  if (getBigPictureGameRouteMatch(normalizedPathname)) {
    return null;
  }

  if (normalizedPathname.startsWith("/component-lab")) {
    return isDev
      ? BIG_PICTURE_SIDEBAR_ITEM_IDS.componentLab
      : BIG_PICTURE_SIDEBAR_ITEM_IDS.home;
  }

  if (normalizedPathname.startsWith("/catalogue")) {
    return BIG_PICTURE_SIDEBAR_ITEM_IDS.catalogue;
  }

  if (normalizedPathname.startsWith("/downloads")) {
    return BIG_PICTURE_SIDEBAR_ITEM_IDS.downloads;
  }

  if (normalizedPathname.startsWith("/settings")) {
    return BIG_PICTURE_SIDEBAR_ITEM_IDS.settings;
  }

  if (normalizedPathname.startsWith("/profile")) {
    return BIG_PICTURE_SIDEBAR_PROFILE_ID;
  }

  if (normalizedPathname.startsWith("/library")) {
    return BIG_PICTURE_SIDEBAR_ITEM_IDS.library;
  }

  return BIG_PICTURE_SIDEBAR_ITEM_IDS.home;
}

export function getBigPictureContentEntryRegionIdFromPathname(
  pathname: string
) {
  const normalizedPathname = normalizeBigPicturePathname(pathname);

  if (normalizedPathname === "/") {
    return HOME_PAGE_REGION_ID;
  }

  if (normalizedPathname.startsWith("/catalogue")) {
    return CATALOGUE_GRID_REGION_ID;
  }

  if (normalizedPathname.startsWith("/library")) {
    return LIBRARY_PAGE_REGION_ID;
  }

  if (normalizedPathname.startsWith("/downloads")) {
    return DOWNLOADS_PAGE_REGION_ID;
  }

  if (normalizedPathname.startsWith("/settings")) {
    return SETTINGS_PAGE_REGION_ID;
  }

  if (normalizedPathname.startsWith("/profile")) {
    return PROFILE_PAGE_REGION_ID;
  }

  if (getBigPictureGameRouteMatch(normalizedPathname)) {
    return GAME_PAGE_REGION_ID;
  }

  return null;
}

export function getBigPictureContentRouteEntryTargetFromPathname(
  pathname: string
): FocusOverrideTarget {
  const regionId = getBigPictureContentEntryRegionIdFromPathname(pathname);

  if (!regionId) {
    return {
      type: "region",
      regionId: BIG_PICTURE_CONTENT_REGION_ID,
      entryDirection: "right",
    };
  }

  return {
    type: "region",
    regionId,
    entryDirection: "right",
    preferRememberedFocus: false,
  };
}

export function getBigPictureContentSidebarReturnTargetFromPathname(
  pathname: string
): FocusOverrideTarget {
  const regionId = getBigPictureContentEntryRegionIdFromPathname(pathname);

  if (!regionId) {
    return {
      type: "region",
      regionId: BIG_PICTURE_CONTENT_REGION_ID,
      entryDirection: "right",
    };
  }

  return {
    type: "region",
    regionId,
    entryDirection: "right",
  };
}
