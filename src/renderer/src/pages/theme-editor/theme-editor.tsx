import { useCallback, useEffect, useMemo, useState } from "react";
import "./theme-editor.scss";
import Editor from "@monaco-editor/react";
import { AchievementCustomNotificationPosition, Theme } from "@types";
import { useSearchParams } from "react-router-dom";
import { Button, SelectField } from "@renderer/components";
import { CheckIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import cn from "classnames";
import { injectCustomCss } from "@renderer/helpers";
import { AchievementNotificationItem } from "@renderer/components/achievements/notification/achievement-notification";
import { generateAchievementCustomNotificationTest } from "@shared";
import { CollapsedMenu } from "@renderer/components/collapsed-menu/collapsed-menu";
import app from "../../app.scss?inline";
import styles from "../../components/achievements/notification/achievement-notification.scss?inline";
import root from "react-shadow";

const notificationVariations = {
  default: "default",
  rare: "rare",
  platinum: "platinum",
  hidden: "hidden",
};

export default function ThemeEditor() {
  const [searchParams] = useSearchParams();
  const [theme, setTheme] = useState<Theme | null>(null);
  const [code, setCode] = useState("");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const [isClosingNotifications, setIsClosingNotifications] = useState(false);

  const themeId = searchParams.get("themeId");

  const { t, i18n } = useTranslation("settings");

  const [notificationVariation, setNotificationVariation] =
    useState<keyof typeof notificationVariations>("default");
  const [notificationAlignment, setNotificationAlignment] =
    useState<AchievementCustomNotificationPosition>("top-left");

  const [shadowRootRef, setShadowRootRef] = useState<HTMLElement | null>(null);

  const achievementPreview = useMemo(() => {
    return {
      achievement: generateAchievementCustomNotificationTest(t, i18n.language, {
        isRare: notificationVariation === "rare",
        isHidden: notificationVariation === "hidden",
        isPlatinum: notificationVariation === "platinum",
      }),
      position: notificationAlignment,
    };
  }, [t, i18n.language, notificationVariation, notificationAlignment]);

  useEffect(() => {
    window.document.title = "Hydra - Theme Editor";
  }, []);

  useEffect(() => {
    if (themeId) {
      window.electron.getCustomThemeById(themeId).then((loadedTheme) => {
        if (loadedTheme) {
          setTheme(loadedTheme);
          setCode(loadedTheme.code);
          if (shadowRootRef) {
            injectCustomCss(loadedTheme.code, shadowRootRef);
          }
        }
      });
    }
  }, [themeId, shadowRootRef]);

  const handleSave = useCallback(async () => {
    if (theme) {
      await window.electron.updateCustomTheme(theme.id, code);
      setHasUnsavedChanges(false);
      setIsClosingNotifications(true);
      setTimeout(() => {
        if (shadowRootRef) {
          injectCustomCss(code, shadowRootRef);
        }

        setIsClosingNotifications(false);
      }, 450);
    }
  }, [code, theme, shadowRootRef]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
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

  const achievementCustomNotificationPositionOptions = useMemo(() => {
    return [
      "top-left",
      "top-center",
      "top-right",
      "bottom-left",
      "bottom-center",
      "bottom-right",
    ].map((position) => ({
      key: position,
      value: position,
      label: t(position),
    }));
  }, [t]);

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

      <div className="theme-editor__editor">
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
          }}
        >
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
        </div>
      </div>

      <div className="theme-editor__footer">
        <CollapsedMenu title={t("notification_preview")}>
          <div className="theme-editor__notification-preview">
            <SelectField
              className="theme-editor__notification-preview__select-variation"
              label={t("variation")}
              options={Object.values(notificationVariations).map(
                (variation) => {
                  return {
                    key: variation,
                    value: variation,
                    label: t(variation),
                  };
                }
              )}
              onChange={(value) =>
                setNotificationVariation(
                  value.target.value as keyof typeof notificationVariations
                )
              }
            />

            <SelectField
              label={t("alignment")}
              value={notificationAlignment}
              onChange={(e) =>
                setNotificationAlignment(
                  e.target.value as AchievementCustomNotificationPosition
                )
              }
              options={achievementCustomNotificationPositionOptions}
            />

            <div className="theme-editor__notification-preview-wrapper">
              <root.div>
                <style type="text/css">
                  {app} {styles}
                </style>
                <section ref={(ref) => setShadowRootRef(ref)}>
                  <AchievementNotificationItem
                    position={achievementPreview.position}
                    achievement={achievementPreview.achievement}
                    isClosing={isClosingNotifications}
                  />
                </section>
              </root.div>
            </div>
          </div>
        </CollapsedMenu>

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
