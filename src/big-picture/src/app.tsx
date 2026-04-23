import { Fragment, useEffect } from "react";
import { Outlet, useSearchParams } from "react-router-dom";
import { Header, Sidebar } from "./layout";
import { IS_DESKTOP } from "./constants";
import {
  NavigationInputProvider,
  NavigationStateBridge,
  NavigationDiagnostics,
  HorizontalFocusGroup,
  VerticalFocusGroup,
} from "./components";

import "./styles/globals.scss";

export default function App() {
  const [searchParams] = useSearchParams();
  const showNavigationDiagnostics =
    import.meta.env.DEV || searchParams.get("debugNavigation") === "1";

  useEffect(() => {
    if (!IS_DESKTOP) {
      document.documentElement.style.colorScheme = "dark";
    }
  }, []);

  return (
    <Fragment>
      <NavigationStateBridge />
      {showNavigationDiagnostics && <NavigationDiagnostics />}

      <NavigationInputProvider>
        <HorizontalFocusGroup regionId="main-layout" asChild>
          <div id="big-picture">
            <Sidebar />

            <VerticalFocusGroup asChild>
              <div className="big-picture__layout">
                <Header />

                <article className="big-picture__content">
                  <Outlet />
                </article>
              </div>
            </VerticalFocusGroup>
          </div>
        </HorizontalFocusGroup>
      </NavigationInputProvider>
    </Fragment>
  );
}
