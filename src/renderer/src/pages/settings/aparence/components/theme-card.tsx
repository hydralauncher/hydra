import { PencilIcon, TrashIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components/button/button";
import type { Theme } from "@types";
import { useNavigate } from "react-router-dom";
import "./theme-card.scss";
import { useEffect, useMemo, useState } from "react";
import { SelectField } from "@renderer/components/select-field/select-field";
import { DeleteThemeModal } from "../modals/delete-theme-modal";
import { injectCustomCss, removeCustomCss } from "@renderer/helpers";
import { THEME_WEB_STORE_URL } from "@renderer/constants";

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
  const variantStorageKey = useMemo(
    () => `customThemeVariant:${theme.id}`,
    [theme.id]
  );
  const [selectedVariant, setSelectedVariant] = useState<string>("root");

  const parseVarsFromBlock = (content: string) => {
    const vars: { key: string; value: string }[] = [];
    const isNameChar = (c: string) => {
      const x = c.charCodeAt(0);
      return (
        (x >= 48 && x <= 57) ||
        (x >= 65 && x <= 90) ||
        (x >= 97 && x <= 122) ||
        c === "_" ||
        c === "-"
      );
    };
    const len = content.length;
    let i = 0;
    while (i < len) {
      const startIdx = content.indexOf("--", i);
      if (startIdx === -1) break;
      let j = startIdx + 2;
      while (j < len && isNameChar(content[j])) j++;
      const name = content.slice(startIdx, j).trim();
      while (j < len && /\s/.test(content[j])) j++;
      if (j >= len || content[j] !== ":") {
        i = j + 1;
        continue;
      }
      j++;
      while (j < len && /\s/.test(content[j])) j++;
      const valueStart = j;
      let paren = 0;
      let inSingle = false;
      let inDouble = false;
      while (j < len) {
        const ch = content[j];
        if (!inSingle && !inDouble) {
          if (ch === "(") paren++;
          else if (ch === ")") paren = Math.max(0, paren - 1);
          else if (ch === '"') inDouble = true;
          else if (ch === "'") inSingle = true;
          else if (ch === ";" && paren === 0) break;
        } else if (inDouble) {
          if (ch === '"') inDouble = false;
        } else if (inSingle) {
          if (ch === "'") inSingle = false;
        }
        j++;
      }
      const value = content.slice(valueStart, j).trim();
      if (name) vars.push({ key: name, value });
      if (j < len && content[j] === ";") j++;
      i = j;
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
    const isValidChar = (c: string) => {
      const x = c.charCodeAt(0);
      return (
        (x >= 48 && x <= 57) ||
        (x >= 65 && x <= 90) ||
        (x >= 97 && x <= 122) ||
        c === "_" ||
        c === "-"
      );
    };
    const len = code.length;
    let i = 0;
    while (i < len) {
      if (code[i] !== ":") {
        i++;
        continue;
      }
      let j = i + 1;
      while (j < len && /\s/.test(code[j])) j++;
      const start = j;
      while (j < len && isValidChar(code[j])) j++;
      const name = code.slice(start, j).toLowerCase();
      if (!name) {
        i++;
        continue;
      }
      while (j < len && /\s/.test(code[j])) j++;
      if (j >= len || code[j] !== "{") {
        i++;
        continue;
      }
      j++;
      const contentStart = j;
      while (j < len && code[j] !== "}") j++;
      const content = code.slice(contentStart, j);
      if (!disallowed.has(name)) {
        const hasVars = parseVarsFromBlock(content).length > 0;
        if (hasVars) blocks.push({ name, content });
      }
      i = j + 1;
    }
    return blocks;
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
            {theme.readOnly ? null : (
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
            )}

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
