import { useCallback, useContext, useEffect, useState } from "react";
import "./settings-appearance.scss";
import { ThemeActions, ThemeCard, ThemePlaceholder } from "./index";
import type { Theme } from "@types";
import { ImportThemeModal } from "./modals/import-theme-modal";
import { settingsContext } from "@renderer/context";
import { useNavigate } from "react-router-dom";

interface SettingsAppearanceProps {
  appearance: {
    theme: string | null;
    authorId: string | null;
    authorName: string | null;
  };
}

export function SettingsAppearance({
  appearance,
}: Readonly<SettingsAppearanceProps>) {
  const [themes, setThemes] = useState<Theme[]>([]);
  const [isImportThemeModalVisible, setIsImportThemeModalVisible] =
    useState(false);
  const [importTheme, setImportTheme] = useState<{
    theme: string;
    authorId: string;
    authorName: string;
  } | null>(null);
  const [hasShownModal, setHasShownModal] = useState(false);

  const { clearTheme } = useContext(settingsContext);
  const navigate = useNavigate();

  const loadThemes = useCallback(async () => {
    const themesList = await window.electron.getAllCustomThemes();
    setThemes(themesList);
  }, []);

  useEffect(() => {
    loadThemes();
  }, [loadThemes]);

  useEffect(() => {
    const unsubscribe = window.electron.onCssInjected(() => {
      loadThemes();
    });

    return () => unsubscribe();
  }, [loadThemes]);

  useEffect(() => {
    if (appearance.theme && appearance.authorId && appearance.authorName && !hasShownModal) {
      setIsImportThemeModalVisible(true);
      setImportTheme({
        theme: appearance.theme,
        authorId: appearance.authorId,
        authorName: appearance.authorName,
      });
      setHasShownModal(true);

      navigate("/settings", { replace: true });
      clearTheme();
    }
  }, [
    appearance.theme,
    appearance.authorId,
    appearance.authorName,
    navigate,
    hasShownModal,
    clearTheme,
  ]);

  const onThemeImported = useCallback(() => {
    setIsImportThemeModalVisible(false);
    setImportTheme(null);
    loadThemes();
  }, [loadThemes]);

  return (
    <div className="settings-appearance">
      <ThemeActions onListUpdated={loadThemes} themesCount={themes.length} />

      <div className="settings-appearance__themes">
        {!themes.length ? (
          <ThemePlaceholder onListUpdated={loadThemes} />
        ) : (
          [...themes]
            .sort(
              (a, b) =>
                new Date(b.updatedAt).getTime() -
                new Date(a.updatedAt).getTime()
            )
            .map((theme) => (
              <ThemeCard
                key={theme.id}
                theme={theme}
                onListUpdated={loadThemes}
              />
            ))
        )}
      </div>

      {importTheme && (
        <ImportThemeModal
          visible={isImportThemeModalVisible}
          onClose={() => {
            setIsImportThemeModalVisible(false);
            clearTheme();
          }}
          onThemeImported={onThemeImported}
          themeName={importTheme.theme}
          authorId={importTheme.authorId}
          authorName={importTheme.authorName}
        />
      )}
    </div>
  );
}
