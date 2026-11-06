import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  BIG_PICTURE_APP_LAYER_ID,
  BIG_PICTURE_CONTENT_REGION_ID,
  BIG_PICTURE_SHELL_REGION_ID,
  getBigPictureContentEntryRegionIdFromPathname,
  BIG_PICTURE_SIDEBAR_ITEM_IDS,
  getBigPictureGameRouteMatch,
  getBigPictureSidebarLibraryGameFocusId,
  getBigPictureSidebarItemIdFromPathname,
  normalizeBigPicturePathname,
  Header,
  Sidebar,
} from "./layout";
import { IS_DESKTOP } from "./constants";
import {
  useBigPictureToast,
  useNavigationActions,
  useUserPreferences,
} from "./hooks";
import {
  HorizontalFocusGroup,
  InputModeProvider,
  NavigationHistoryBridge,
  NavigationLayer,
  NavigationAutoScrollBridge,
  NavigationInputProvider,
  NavigationStateBridge,
  NavigationDiagnostics,
  VerticalFocusGroup,
  BigPictureToastHost,
  CloudGiftNotificationModal,
  MissingScreenshotsToast,
  ScreenshotUploadFailureToast,
  VirtualKeyboardProvider,
} from "./components";
import { getItemFocusTarget } from "./helpers";
import {
  initializeBigPictureRunningGamesStore,
  useInputModeStore,
  useNavigationStore,
} from "./stores";
import { NavigationAudioService, type FocusOverrides } from "./services";
import { BigPictureI18nBridge, ensureBigPictureI18nResources } from "./i18n";
import { hasLibraryViewState } from "./components/pages/library/library-view-state";

import "./styles/globals.scss";

interface RouteFocusBridgeProps {
  pathname: string;
  pendingRouteFocusPathname: string | null;
  onFocusResolved: (pathname: string | null) => void;
}

function RouteFocusBridge({
  pathname,
  pendingRouteFocusPathname,
  onFocusResolved,
}: Readonly<RouteFocusBridgeProps>) {
  const { setFocusRegion } = useNavigationActions();
  const nodes = useNavigationStore((state) => state.nodes);
  const regions = useNavigationStore((state) => state.regions);

  useEffect(() => {
    if (pendingRouteFocusPathname !== pathname) return;

    if (isLibraryPathname(pathname) && hasLibraryViewState()) {
      onFocusResolved(null);
      return;
    }

    const entryRegionId =
      getBigPictureContentEntryRegionIdFromPathname(pathname);
    if (!entryRegionId) return;
    if (!regions.some((region) => region.id === entryRegionId)) return;

    const focusedId = setFocusRegion(entryRegionId, "right", {
      preferRememberedFocus: false,
    });

    if (focusedId) {
      onFocusResolved(null);
    }
  }, [
    nodes,
    onFocusResolved,
    pathname,
    pendingRouteFocusPathname,
    regions,
    setFocusRegion,
  ]);

  return null;
}

const RENDERER_CACHE_SECOND_CLEAR_DELAY_MS = 1000;
const RENDERER_CACHE_HEAVY_ROUTE_PREFIXES = ["/catalogue", "/library"];

function isRendererCacheHeavyRoute(pathname: string) {
  const normalizedPathname = normalizeBigPicturePathname(pathname);

  return (
    normalizedPathname === "/" ||
    RENDERER_CACHE_HEAVY_ROUTE_PREFIXES.some((prefix) =>
      normalizedPathname.startsWith(prefix)
    )
  );
}

function clearRendererCache() {
  try {
    globalThis.window.electron?.clearRendererCache?.();
  } catch {
    return;
  }
}

function isLibraryPathname(pathname: string) {
  return normalizeBigPicturePathname(pathname).startsWith("/library");
}

function RendererCacheCleanupBridge({ pathname }: { pathname: string }) {
  const previousPathnameRef = useRef(pathname);
  const delayedClearTimerRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const previousPathname = previousPathnameRef.current;
    previousPathnameRef.current = pathname;

    if (previousPathname === pathname) return;
    if (!isRendererCacheHeavyRoute(previousPathname)) return;

    clearRendererCache();

    if (delayedClearTimerRef.current !== null) {
      globalThis.window.clearTimeout(delayedClearTimerRef.current);
    }

    delayedClearTimerRef.current = globalThis.window.setTimeout(() => {
      delayedClearTimerRef.current = null;
      clearRendererCache();
    }, RENDERER_CACHE_SECOND_CLEAR_DELAY_MS);
  }, [pathname]);

  useEffect(() => {
    return () => {
      if (delayedClearTimerRef.current !== null) {
        globalThis.window.clearTimeout(delayedClearTimerRef.current);
      }
    };
  }, []);

  return null;
}

export default function App() {
  ensureBigPictureI18nResources();

  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { showErrorToast, showSuccessToast, showWarningToast } =
    useBigPictureToast();
  const userPreferences = useUserPreferences();
  const inputMode = useInputModeStore((state) => state.mode);
  const [pendingRouteFocusPathname, setPendingRouteFocusPathname] = useState<
    string | null
  >(pathname);
  const activeSidebarItemId = getBigPictureSidebarItemIdFromPathname(pathname);
  const activeGameRoute = getBigPictureGameRouteMatch(pathname);
  const leftSidebarTargetId = activeGameRoute
    ? getBigPictureSidebarLibraryGameFocusId(activeGameRoute)
    : (activeSidebarItemId ?? BIG_PICTURE_SIDEBAR_ITEM_IDS.library);
  const contentNavigationOverrides: FocusOverrides = {
    left: getItemFocusTarget(leftSidebarTargetId),
  };

  useEffect(() => {
    if (!IS_DESKTOP) {
      document.documentElement.style.colorScheme = "dark";
      return;
    }

    initializeBigPictureRunningGamesStore();
  }, []);

  useEffect(() => {
    if (!IS_DESKTOP) return;

    return globalThis.window.electron.onNavigate((path) => {
      if (path.startsWith("/big-picture")) {
        navigate(path);
      }
    });
  }, [navigate]);

  useEffect(() => {
    if (!IS_DESKTOP) return;

    const unsubscribeExtractionFailed =
      globalThis.window.electron.onExtractionFailed(
        (_shop, _objectId, failure) => {
          if (failure?.reason === "unsupported-format") {
            showErrorToast(
              t("extraction_unsupported_format_title", { ns: "downloads" }),
              {
                message: t("extraction_unsupported_format_description", {
                  ns: "downloads",
                  format: failure.format,
                }),
              }
            );
            return;
          }

          if (failure?.reason === "file-not-found") {
            showErrorToast(
              t("extraction_file_not_found_title", { ns: "downloads" }),
              {
                message: t("extraction_file_not_found_description", {
                  ns: "downloads",
                }),
              }
            );
            return;
          }

          showErrorToast(t("extraction_failed_title", { ns: "downloads" }), {
            message: t("extraction_failed_description", { ns: "downloads" }),
          });
        }
      );

    const unsubscribeExecutableNotFound =
      globalThis.window.electron.onGameExecutableNotFound(() => {
        showErrorToast(
          t("executable_not_found_title", { ns: "game_details" }),
          {
            message: t("executable_not_found_big_picture_description", {
              ns: "game_details",
            }),
          }
        );
      });

    const unsubscribeInstallerClosed =
      globalThis.window.electron.onGameInstallerClosed(
        (_shop, _objectId, executableFound) => {
          if (executableFound) {
            showSuccessToast(t("game_installed_title", { ns: "downloads" }), {
              message: t("game_installed_description", { ns: "downloads" }),
              fallbackVisual: "downloads",
            });
            return;
          }

          showWarningToast(
            t("installed_game_not_found_title", { ns: "downloads" }),
            {
              message: t("installed_game_not_found_description", {
                ns: "downloads",
              }),
              fallbackVisual: "downloads",
            }
          );
        }
      );

    return () => {
      unsubscribeExtractionFailed();
      unsubscribeExecutableNotFound();
      unsubscribeInstallerClosed();
    };
  }, [showErrorToast, showSuccessToast, showWarningToast, t]);

  useEffect(() => {
    setPendingRouteFocusPathname(pathname);
  }, [pathname]);

  useEffect(() => {
    NavigationAudioService.getInstance().setEnabled(
      (userPreferences?.bigPictureSoundsEnabled ?? true) &&
        inputMode === "gamepad"
    );
  }, [userPreferences?.bigPictureSoundsEnabled, inputMode]);

  return (
    <Fragment>
      <RouteFocusBridge
        pathname={pathname}
        pendingRouteFocusPathname={pendingRouteFocusPathname}
        onFocusResolved={setPendingRouteFocusPathname}
      />
      <RendererCacheCleanupBridge pathname={pathname} />
      <NavigationStateBridge />
      <NavigationAutoScrollBridge />
      <NavigationHistoryBridge />

      <NavigationInputProvider>
        <div id="big-picture">
          <BigPictureI18nBridge />

          <NavigationLayer
            layerId={BIG_PICTURE_APP_LAYER_ID}
            rootRegionId={BIG_PICTURE_SHELL_REGION_ID}
            initialFocusRegionId={BIG_PICTURE_CONTENT_REGION_ID}
          >
            <HorizontalFocusGroup
              regionId={BIG_PICTURE_SHELL_REGION_ID}
              autoScrollMode="auto"
              asChild
            >
              <div className="big-picture__app">
                <Sidebar />

                <VerticalFocusGroup
                  regionId={BIG_PICTURE_CONTENT_REGION_ID}
                  navigationOverrides={contentNavigationOverrides}
                  autoScrollMode="auto"
                  asChild
                >
                  <div className="big-picture__layout">
                    <Header />

                    <article className="big-picture__content">
                      <Outlet />
                    </article>

                    <VirtualKeyboardProvider />
                  </div>
                </VerticalFocusGroup>
              </div>
            </HorizontalFocusGroup>
          </NavigationLayer>

          <InputModeProvider />
          <NavigationDiagnostics />
          <BigPictureToastHost />
          <CloudGiftNotificationModal />
          <MissingScreenshotsToast />
          <ScreenshotUploadFailureToast />
        </div>
      </NavigationInputProvider>
    </Fragment>
  );
}
