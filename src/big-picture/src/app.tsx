import { Fragment, useEffect } from "react";
import { Outlet, useSearchParams } from "react-router-dom";
import { Sidebar } from "./layout";
import { IS_DESKTOP } from "./constants";
import {
  NavigationAutoScrollBridge,
  NavigationInputProvider,
  NavigationStateBridge,
  NavigationDiagnostics,
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
      <NavigationAutoScrollBridge />

      <NavigationInputProvider>
        <div id="big-picture">
          <Sidebar />

          <article className="big-picture__content">
            <Outlet />
          </article>

          {showNavigationDiagnostics && <NavigationDiagnostics />}
        </div>
      </NavigationInputProvider>
    </Fragment>
  );
}
