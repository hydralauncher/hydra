import { Outlet } from "react-router-dom";
import { Sidebar } from "./layout";
import "./app.scss";

export default function App() {
  return (
    <div id="big-picture" style={{ width: "100%", display: "flex" }}>
      <Sidebar />

      <article style={{ width: "100%", height: "100%" }}>
        <Outlet />
      </article>
    </div>
  );
}
