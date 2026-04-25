import { Fragment, useEffect } from "react";
import { Outlet, useLocation, useSearchParams } from "react-router-dom";
import {
  BIG_PICTURE_APP_LAYER_ID,
  BIG_PICTURE_CONTENT_REGION_ID,
  BIG_PICTURE_SHELL_REGION_ID,
  getBigPictureSidebarItemIdFromPathname,
  Sidebar,
} from "./layout";
import { IS_DESKTOP } from "./constants";
import {
  HorizontalFocusGroup,
  NavigationLayer,
  NavigationAutoScrollBridge,
  NavigationInputProvider,
  NavigationStateBridge,
  NavigationDiagnostics,
  VerticalFocusGroup,
} from "./components";
import type { FocusOverrides } from "./services";

import "./styles/globals.scss";

export default function App() {
  const [searchParams] = useSearchParams();
  const { pathname } = useLocation();
  const showNavigationDiagnostics =
    import.meta.env.DEV || searchParams.get("debugNavigation") === "1";
  const activeSidebarItemId = getBigPictureSidebarItemIdFromPathname(pathname);
  const contentNavigationOverrides: FocusOverrides = {
    left: {
      type: "item",
      itemId: activeSidebarItemId,
    },
  };

  useEffect(() => {
    if (!IS_DESKTOP) {
      document.documentElement.style.colorScheme = "dark";
    }
  }, []);

  return (
    <Fragment>
      <NavigationStateBridge />
      <NavigationAutoScrollBridge />

      <NavigationInputProvider>
        <NavigationLayer
          layerId={BIG_PICTURE_APP_LAYER_ID}
          rootRegionId={BIG_PICTURE_SHELL_REGION_ID}
          initialFocusRegionId={BIG_PICTURE_CONTENT_REGION_ID}
        >
          <HorizontalFocusGroup
            id="big-picture"
            regionId={BIG_PICTURE_SHELL_REGION_ID}
            autoScrollMode="auto"
            style={{ alignItems: "stretch", gap: 0 }}
          >
            <Sidebar />

            <VerticalFocusGroup
              className="big-picture__content"
              regionId={BIG_PICTURE_CONTENT_REGION_ID}
              navigationOverrides={contentNavigationOverrides}
              autoScrollMode="auto"
              style={{ gap: 0 }}
            >
              <Outlet />
            </VerticalFocusGroup>

            {showNavigationDiagnostics && <NavigationDiagnostics />}
          </HorizontalFocusGroup>
        </NavigationLayer>
      </NavigationInputProvider>
    </Fragment>
  );
}
