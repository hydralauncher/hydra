import { PencilIcon, TrashIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components/button/button";
import type { Theme } from "@types";
import { useNavigate } from "react-router-dom";
import "./theme-card.scss";
import { useState, useEffect } from "react";
import { DeleteThemeModal } from "../modals/delete-theme-modal";
import { injectCustomCss, removeCustomCss } from "@renderer/helpers";
import { THEME_WEB_STORE_URL } from "@renderer/constants";
import { SelectField } from "@renderer/components";

interface ThemeCardProps {
  theme: Theme;
  onListUpdated: () => void;
}

export const ThemeCard = ({ theme, onListUpdated }: ThemeCardProps) => {
  const { t } = useTranslation("settings");
  const navigate = useNavigate();

  const [deleteThemeModalVisible, setDeleteThemeModalVisible] = useState(false);
  const [variantOptions, setVariantOptions] = useState<
    { key: string; value: string; label: string }[]
  >([]);
  const [selectedVariant, setSelectedVariant] = useState<string>("root");
  const variantStorageKey = `customThemeVariant:${theme.id}`;

  const parseVarsFromBlock = (content: string) => {
    const vars: { key: string; value: string }[] = [];
    const pieces = content.split(";");
    for (const piece of pieces) {
      const idx = piece.indexOf(":");
      if (idx === -1) continue;
      const left = piece.slice(0, idx).trim();
      const right = piece.slice(idx + 1).trim();
      if (left.startsWith("--") && right) {
        vars.push({ key: left, value: right });
      }
    }
    return vars;
  };

  const parseVariantBlocks = (code: string) => {
    const blocks: { name: string; content: string }[] = [];
    const disallowed = new Set([
      "hover",
      "active",
      "focus",
      "disabled",
      "before",
      "after",
      "visited",
      "checked",
      "placeholder",
      "focus-visible",
      "focus-within",
      "selection",
      "target",
    ]);
    const codeStr = code;
    let i = 0;
    while (i < codeStr.length) {
      if (codeStr[i] === ":") {
        let j = i + 1;
        while (j < codeStr.length && /\s/.test(codeStr[j])) j++;
        const start = j;
        while (j < codeStr.length && /[a-zA-Z0-9_-]/.test(codeStr[j])) j++;
        const name = codeStr.slice(start, j).toLowerCase();
        while (j < codeStr.length && /\s/.test(codeStr[j])) j++;
        if (codeStr[j] !== "{") {
          i++;
          continue;
        }
        let k = j + 1;
        let depth = 1;
        while (k < codeStr.length && depth > 0) {
          const ch = codeStr[k];
          if (ch === "{") depth++;
          else if (ch === "}") depth--;
          k++;
        }
        const content = codeStr.slice(j + 1, k - 1);
        if (!disallowed.has(name)) {
          const hasVars = parseVarsFromBlock(content).length > 0;
          if (hasVars) blocks.push({ name, content });
        }
        i = k;
      } else {
        i++;
      }
    }
    return blocks;
  };

  const handleSetTheme = async () => {
    try {
      const currentTheme = await globalThis.electron.getCustomThemeById(
        theme.id
      );

      if (!currentTheme) return;

      const activeTheme = await globalThis.electron.getActiveCustomTheme();

      if (activeTheme) {
        removeCustomCss();
        await globalThis.electron.toggleCustomTheme(activeTheme.id, false);
      }

      if (currentTheme.code) {
        injectCustomCss(currentTheme.code);
      }

      await globalThis.electron.toggleCustomTheme(currentTheme.id, true);

      onListUpdated();
    } catch (error) {
      console.error(error);
    }
  };

  const handleUnsetTheme = async () => {
    try {
      removeCustomCss();
      await globalThis.electron.toggleCustomTheme(theme.id, false);

      onListUpdated();
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    const variantBlocks = parseVariantBlocks(theme.code);
    const variantOpts = variantBlocks.length
      ? variantBlocks.map((b) => ({
          key: b.name,
          value: b.name,
          label: b.name,
        }))
      : [{ key: "root", value: "root", label: "root" }];
    setVariantOptions(variantOpts);
    const storedVariant =
      globalThis.localStorage.getItem(variantStorageKey) ||
      variantOpts[0]?.value ||
      "root";
    setSelectedVariant(storedVariant);

    if (theme.isActive) {
      const rootBlock = variantBlocks.find((b) => b.name === "root");
      const selectedBlock = variantBlocks.find((b) => b.name === storedVariant);
      if (rootBlock) {
        parseVarsFromBlock(rootBlock.content).forEach(({ key, value }) => {
          document.documentElement.style.setProperty(key, value);
        });
      }
      if (selectedBlock && storedVariant !== "root") {
        parseVarsFromBlock(selectedBlock.content).forEach(({ key, value }) => {
          document.documentElement.style.setProperty(key, value);
        });
      }
    }
  }, [theme.code, theme.isActive, variantStorageKey]);

  return (
    <>
      <DeleteThemeModal
        visible={deleteThemeModalVisible}
        onClose={() => setDeleteThemeModalVisible(false)}
        onThemeDeleted={onListUpdated}
        themeId={theme.id}
        themeName={theme.name}
        isActive={theme.isActive}
      />

      <div
        className={`theme-card ${theme.isActive ? "theme-card--active" : ""}`}
        key={theme.name}
      >
        <div className="theme-card__header">
          <div className="theme-card__header__title">{theme.name}</div>
          <div className="theme-card__header__controls">
            {variantOptions.length > 1 && (
              <SelectField
                theme="dark"
                label={t("theme_variant")}
                value={selectedVariant}
                options={variantOptions}
                onChange={(e) => {
                  const value = e.target.value;
                  setSelectedVariant(value);
                  globalThis.localStorage.setItem(variantStorageKey, value);
                  const variantBlocks = parseVariantBlocks(theme.code);
                  const rootBlock = variantBlocks.find(
                    (b) => b.name === "root"
                  );
                  const selBlock = variantBlocks.find((b) => b.name === value);
                  if (rootBlock) {
                    parseVarsFromBlock(rootBlock.content).forEach(
                      ({ key, value }) => {
                        document.documentElement.style.setProperty(key, value);
                      }
                    );
                  }
                  if (selBlock && value !== "root") {
                    parseVarsFromBlock(selBlock.content).forEach(
                      ({ key, value }) => {
                        document.documentElement.style.setProperty(key, value);
                      }
                    );
                  }
                }}
              />
            )}
          </div>
        </div>

        {theme.authorName && (
          <p className="theme-card__author">
            {t("by")}

            <button
              className="theme-card__author__name"
              onClick={() => navigate(`/profile/${theme.author}`)}
            >
              {theme.authorName}
            </button>
          </p>
        )}

        <div className="theme-card__actions">
          <div className="theme-card__actions__left">
            {theme.isActive ? (
              <Button onClick={handleUnsetTheme} theme="dark">
                {t("unset_theme")}
              </Button>
            ) : (
              <Button onClick={handleSetTheme} theme="outline">
                {t("set_theme")}
              </Button>
            )}
          </div>

          <div className="theme-card__actions__right">
            <Button
              className={
                theme.code.startsWith(THEME_WEB_STORE_URL)
                  ? "theme-card__actions__right--external"
                  : ""
              }
              onClick={() => globalThis.electron.openEditorWindow(theme.id)}
              title={t("edit_theme")}
              theme="outline"
            >
              <PencilIcon />
            </Button>

            <Button
              onClick={() => setDeleteThemeModalVisible(true)}
              title={t("delete_theme")}
              theme="outline"
            >
              <TrashIcon />
            </Button>
          </div>
        </div>
      </div>
    </>
  );
};
