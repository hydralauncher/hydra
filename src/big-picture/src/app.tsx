import { Fragment, useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import {
  BIG_PICTURE_APP_LAYER_ID,
  BIG_PICTURE_CONTENT_REGION_ID,
  BIG_PICTURE_SHELL_REGION_ID,
  getBigPictureContentEntryRegionIdFromPathname,
  BIG_PICTURE_SIDEBAR_ITEM_IDS,
  getBigPictureGameRouteMatch,
  getBigPictureSidebarLibraryGameFocusId,
  getBigPictureSidebarItemIdFromPathname,
  Header,
  Sidebar,
} from "./layout";
import { IS_DESKTOP } from "./constants";
import { useNavigation, useUserPreferences } from "./hooks";
import {
  HorizontalFocusGroup,
  NavigationHistoryBridge,
  NavigationLayer,
  NavigationAutoScrollBridge,
  NavigationInputProvider,
  NavigationStateBridge,
  NavigationDiagnostics,
  VerticalFocusGroup,
  BigPictureToastHost,
  VirtualKeyboardProvider,
} from "./components";
import { getItemFocusTarget } from "./helpers";
import { initializeBigPictureRunningGamesStore } from "./stores";
import { NavigationAudioService, type FocusOverrides } from "./services";
import { BigPictureI18nBridge, ensureBigPictureI18nResources } from "./i18n";

import "./styles/globals.scss";

export default function App() {
  ensureBigPictureI18nResources();

  const { pathname } = useLocation();
  const { nodes, regions, setFocusRegion } = useNavigation();
  const userPreferences = useUserPreferences();
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
    setPendingRouteFocusPathname(pathname);
  }, [pathname]);

  useEffect(() => {
    if (pendingRouteFocusPathname !== pathname) return;

    const entryRegionId =
      getBigPictureContentEntryRegionIdFromPathname(pathname);
    if (!entryRegionId) return;

    const hasRegion = regions.some((region) => region.id === entryRegionId);
    if (!hasRegion) return;

    const focusedId = setFocusRegion(entryRegionId, "right", {
      preferRememberedFocus: false,
    });

    if (focusedId) {
      setPendingRouteFocusPathname(null);
    }
  }, [
    leftSidebarTargetId,
    nodes,
    pathname,
    pendingRouteFocusPathname,
    regions,
    setFocusRegion,
  ]);

  useEffect(() => {
    NavigationAudioService.getInstance().setEnabled(
      userPreferences?.bigPictureSoundsEnabled ?? true
    );
  }, [userPreferences?.bigPictureSoundsEnabled]);

  return (
    <Fragment>
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

          <NavigationDiagnostics />
          <BigPictureToastHost />
        </div>
      </NavigationInputProvider>
    </Fragment>
  );
}
