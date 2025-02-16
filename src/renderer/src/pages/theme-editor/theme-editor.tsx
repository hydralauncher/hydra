import { useCallback, useEffect, useState } from "react";
import "./theme-editor.scss";
import Editor from "@monaco-editor/react";
import { Theme } from "@types";
import { useSearchParams } from "react-router-dom";
import { Button } from "@renderer/components";
import { CheckIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import cn from "classnames";

export default function ThemeEditor() {
  const [searchParams] = useSearchParams();
  const [theme, setTheme] = useState<Theme | null>(null);
  const [code, setCode] = useState("");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const themeId = searchParams.get("themeId");

  const { t } = useTranslation("settings");

  useEffect(() => {
    if (themeId) {
      window.electron.getCustomThemeById(themeId).then((loadedTheme) => {
        if (loadedTheme) {
          setTheme(loadedTheme);
          setCode(loadedTheme.code);
        }
      });
    }
  }, [themeId]);

  const handleSave = useCallback(async () => {
    if (theme) {
      const updatedTheme = {
        ...theme,
        code: code,
        updatedAt: new Date(),
      };

      await window.electron.updateCustomTheme(theme.id, updatedTheme);
      setHasUnsavedChanges(false);

      if (theme.isActive) {
        window.electron.injectCSS(code);
      }
    }
  }, [code, theme]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "s") {
        event.preventDefault();
        handleSave();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [code, handleSave, theme]);

  const handleEditorChange = (value: string | undefined) => {
    if (value !== undefined) {
      setCode(value);
      setHasUnsavedChanges(true);
    }
  };

  return (
    <div className="theme-editor">
      <div
        className={cn("theme-editor__header", {
          "theme-editor__header--darwin": window.electron.platform === "darwin",
        })}
      >
        <h1>{theme?.name}</h1>
        {hasUnsavedChanges && (
          <div className="theme-editor__header__status"></div>
        )}
      </div>

      <Editor
        theme="vs-dark"
        defaultLanguage="css"
        value={code}
        onChange={handleEditorChange}
        options={{
          minimap: { enabled: false },
          fontSize: 14,
          lineNumbers: "on",
          wordWrap: "on",
          automaticLayout: true,
        }}
      />

      <div className="theme-editor__footer">
        <div className="theme-editor__footer-actions">
          <Button onClick={handleSave}>
            <CheckIcon />
            {t("editor_tab_save")}
          </Button>
        </div>
      </div>
    </div>
  );
}
