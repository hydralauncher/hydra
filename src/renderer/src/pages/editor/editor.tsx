import { useEffect, useState } from "react";
import { SkeletonTheme } from "react-loading-skeleton";
import { vars } from "@renderer/theme.css";
import "./editor.scss";
import { Editor as Monaco } from "@monaco-editor/react";

export default function Editor() {
  const [code, setCode] = useState("");
  const [currentCode, setCurrentCode] = useState("");
  const [updated, setUpdated] = useState(true);

  useEffect(() => {
    console.log("spectre");
  }, []);

  useEffect(() => {
    setUpdated(currentCode === code);
  }, [code, currentCode]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        setCode(currentCode);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentCode]);

  const handleEditorChange = (value: string | undefined) => {
    setCurrentCode(value || "");
  };

  return (
    <SkeletonTheme baseColor={vars.color.background} highlightColor="#444">
      <div className="editor-header">
        <div className="editor-header-title">
          <h1>CSS Editor</h1>
          {!updated && <div className="editor-header-status"/>}
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
        <Monaco
          height="100%"
          width="100%"
          defaultLanguage="css"
          theme="vs-dark"
          value={currentCode}
          onChange={handleEditorChange}
          defaultValue={code}
          className="editor-monaco"
        />
      </div>
    </SkeletonTheme>
  );
}
