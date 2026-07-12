import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "./theme-editor.scss";
import Editor from "@monaco-editor/react";
import type {
  AchievementCustomNotificationPosition,
  AchievementNotificationVariation,
  Theme,
} from "@types";
import { useSearchParams } from "react-router-dom";
import { Button } from "@renderer/components";
import { CheckIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import cn from "classnames";
import { injectCustomCss } from "@renderer/helpers";
import { AchievementNotificationItem } from "@renderer/components/achievements/notification/achievement-notification";
import {
  generateAchievementCustomNotificationTest,
  getAchievementNotificationPreviewFlags,
  getEffectiveAchievementNotificationCss,
  parseAchievementNotificationManagedCss,
} from "@shared";
import { CollapsedMenu } from "@renderer/components/collapsed-menu/collapsed-menu";
import { levelDBService } from "@renderer/services/leveldb.service";
import app from "../../app.scss?inline";
import styles from "../../components/achievements/notification/achievement-notification.scss?inline";
import root from "react-shadow";
import { AchievementNotificationCustomizer } from "./achievement-notification-customizer";

const notificationPositions = new Set<AchievementCustomNotificationPosition>([
  "top-left",
  "top-center",
  "top-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
]);

export default function ThemeEditor() {
  const [searchParams] = useSearchParams();
  const [theme, setTheme] = useState<Theme | null>(null);
  const [code, setCode] = useState("");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isClosingNotifications, setIsClosingNotifications] = useState(false);
  const [editorHeight, setEditorHeight] = useState<number>();
  const [editorResizeStart, setEditorResizeStart] = useState<{
    pointerId: number;
    clientY: number;
    height: number;
  }>();
  const editorRef = useRef<HTMLDivElement>(null);

  const themeId = searchParams.get("themeId");

  const { t, i18n } = useTranslation("settings");

  const [notificationVariation, setNotificationVariation] =
    useState<AchievementNotificationVariation>("default");

  const [shadowRootRef, setShadowRootRef] = useState<HTMLElement | null>(null);

  const notificationStyle = useMemo(() => {
    const parsed = parseAchievementNotificationManagedCss(code);
    return getEffectiveAchievementNotificationCss(
      parsed.variations,
      notificationVariation
    );
  }, [code, notificationVariation]);

  const achievementPreview = useMemo(() => {
    const position = notificationPositions.has(
      notificationStyle.position as AchievementCustomNotificationPosition
    )
      ? (notificationStyle.position as AchievementCustomNotificationPosition)
      : "top-left";

    return {
      achievement: generateAchievementCustomNotificationTest(t, i18n.language, {
        ...getAchievementNotificationPreviewFlags(notificationVariation),
      }),
      position,
    };
  }, [t, i18n.language, notificationVariation, notificationStyle.position]);

  useEffect(() => {
    window.document.title = "Hydra - Theme Editor";
  }, []);

  useEffect(() => {
    if (themeId) {
      levelDBService.get(themeId, "themes").then((loadedTheme) => {
        const theme = loadedTheme as Theme | null;
        if (theme) {
          setTheme(theme);
          setCode(theme.code);
        }
      });
    }
  }, [themeId]);

  useEffect(() => {
    if (shadowRootRef) injectCustomCss(code, shadowRootRef);
  }, [code, shadowRootRef]);

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

  const handleEditorResizeStart = (
    event: ReactPointerEvent<HTMLDivElement>
  ) => {
    const height = editorRef.current?.getBoundingClientRect().height;
    if (!height) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setEditorResizeStart({
      pointerId: event.pointerId,
      clientY: event.clientY,
      height,
    });
  };

  const handleEditorResizeMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== editorResizeStart?.pointerId) return;

    const minimumHeight = 240;
    const maximumHeight = Math.max(minimumHeight, window.innerHeight - 100);
    const nextHeight = Math.min(
      maximumHeight,
      Math.max(
        minimumHeight,
        editorResizeStart.height + event.clientY - editorResizeStart.clientY
      )
    );

    setEditorHeight(nextHeight);
  };

  const handleEditorResizeEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== editorResizeStart?.pointerId) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setEditorResizeStart(undefined);
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

      <div
        ref={editorRef}
        className="theme-editor__editor"
        style={editorHeight ? { height: editorHeight } : undefined}
      >
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
        <hr
          className="theme-editor__editor-resize-handle"
          onPointerDown={handleEditorResizeStart}
          onPointerMove={handleEditorResizeMove}
          onPointerUp={handleEditorResizeEnd}
          onPointerCancel={handleEditorResizeEnd}
        />
      </div>

      <div className="theme-editor__footer">
        <CollapsedMenu title={t("notification_preview")}>
          <div className="theme-editor__notification-preview">
            <div className="theme-editor__notification-preview-controls">
              {theme && (
                <AchievementNotificationCustomizer
                  theme={theme}
                  code={code}
                  variation={notificationVariation}
                  onVariationChange={setNotificationVariation}
                  onCodeChange={(nextCode) => {
                    setCode(nextCode);
                    setHasUnsavedChanges(true);
                  }}
                  onThemeChange={setTheme}
                />
              )}
            </div>

            <div className="theme-editor__notification-preview-sidebar">
              <div className="theme-editor__notification-preview-wrapper">
                <root.div>
                  <style type="text/css">
                    {app} {styles}
                  </style>
                  <section ref={setShadowRootRef}>
                    <AchievementNotificationItem
                      position={achievementPreview.position}
                      achievement={achievementPreview.achievement}
                      isClosing={isClosingNotifications}
                    />
                  </section>
                </root.div>
              </div>
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
