export const BIG_PICTURE_APP_LAYER_ID = "big-picture-app-layer";
export const BIG_PICTURE_SHELL_REGION_ID = "big-picture-shell";
export const BIG_PICTURE_SIDEBAR_REGION_ID = "big-picture-sidebar";
export const BIG_PICTURE_CONTENT_REGION_ID = "big-picture-content";

export const BIG_PICTURE_SIDEBAR_ITEM_IDS = {
  home: "big-picture-sidebar-home",
  catalogue: "big-picture-sidebar-catalogue",
  library: "big-picture-sidebar-library",
  downloads: "big-picture-sidebar-downloads",
  settings: "big-picture-sidebar-settings",
} as const;

export type BigPictureSidebarRouteKey =
  keyof typeof BIG_PICTURE_SIDEBAR_ITEM_IDS;

function normalizePathname(pathname: string) {
  const withoutTrailingSlash = pathname.replace(/\/+$/, "") || "/";

  if (withoutTrailingSlash === "/big-picture") return "/";

  if (withoutTrailingSlash.startsWith("/big-picture/")) {
    return withoutTrailingSlash.slice("/big-picture".length) || "/";
  }

  return withoutTrailingSlash;
}

export function getBigPictureSidebarItemIdFromPathname(pathname: string) {
  const normalizedPathname = normalizePathname(pathname);
  const isDev = import.meta.env.DEV;

  if (normalizedPathname.startsWith("/catalogue")) {
    return isDev
      ? BIG_PICTURE_SIDEBAR_ITEM_IDS.catalogue
      : BIG_PICTURE_SIDEBAR_ITEM_IDS.home;
  }

  if (normalizedPathname.startsWith("/downloads")) {
    return isDev
      ? BIG_PICTURE_SIDEBAR_ITEM_IDS.downloads
      : BIG_PICTURE_SIDEBAR_ITEM_IDS.home;
  }

  if (normalizedPathname.startsWith("/settings")) {
    return BIG_PICTURE_SIDEBAR_ITEM_IDS.settings;
  }

  if (normalizedPathname.startsWith("/library")) {
    return BIG_PICTURE_SIDEBAR_ITEM_IDS.library;
  }

  return BIG_PICTURE_SIDEBAR_ITEM_IDS.home;
}
