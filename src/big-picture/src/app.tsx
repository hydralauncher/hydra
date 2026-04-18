import { Outlet } from "react-router-dom";
import { Sidebar } from "./layout";
import "./app.scss";
import { useEffect } from "react";
import { IS_DESKTOP } from "./constants";

export default function App() {
  useEffect(() => {
    if (!IS_DESKTOP) {
      document.documentElement.style.colorScheme = "dark";
    }
  }, []);

  return (
    <div id="big-picture" style={{ width: "100%", display: "flex" }}>
      <Sidebar />

      <article style={{ width: "100%", height: "100%" }}>
        <Outlet />
      </article>
    </div>
  );
}
