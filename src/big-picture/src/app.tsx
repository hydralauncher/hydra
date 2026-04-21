import { Fragment, useEffect } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "./layout";
import { IS_DESKTOP } from "./constants";
import {
  NavigationInputProvider,
  NavigationStateBridge,
  NavigationDiagnostics,
} from "./components";

import "./styles/globals.scss";

export default function App() {
  useEffect(() => {
    if (!IS_DESKTOP) {
      document.documentElement.style.colorScheme = "dark";
    }
  }, []);

  return (
    <Fragment>
      <NavigationStateBridge />
      <NavigationDiagnostics />

      <NavigationInputProvider>
        <div id="big-picture" style={{ width: "100%", display: "flex" }}>
          <Sidebar />

          <article style={{ width: "100%", height: "100%" }}>
            <Outlet />
          </article>
        </div>
      </NavigationInputProvider>
    </Fragment>
  );
}
