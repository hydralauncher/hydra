import { useEffect } from "react";
import { SkeletonTheme } from "react-loading-skeleton";
import { vars } from "@renderer/theme.css";
import "./editor.scss";

export default function Editor() {
  useEffect(() => {
    console.log("spectre");
  }, []);

  return (
    <SkeletonTheme baseColor={vars.color.background} highlightColor="#444">
      <div className="editor-header">
        <div className="editor-header-title">
          <h1>CSS Editor</h1>
        </div>
      </div>

      <div
        className="editor"
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <p>spectre</p>
      </div>
    </SkeletonTheme>
  );
}
