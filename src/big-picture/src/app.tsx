import { Fragment, useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import {
  BIG_PICTURE_APP_LAYER_ID,
  BIG_PICTURE_CONTENT_REGION_ID,
  BIG_PICTURE_SHELL_REGION_ID,
  getBigPictureSidebarItemIdFromPathname,
  Header,
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
  const { pathname } = useLocation();
  const showNavigationDiagnostics = import.meta.env.DEV;
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
            regionId={BIG_PICTURE_SHELL_REGION_ID}
            autoScrollMode="auto"
            asChild
          >
            <div id="big-picture">
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
                </div>
              </VerticalFocusGroup>

              {showNavigationDiagnostics && <NavigationDiagnostics />}
            </div>
          </HorizontalFocusGroup>
        </NavigationLayer>
      </NavigationInputProvider>
    </Fragment>
  );
}
