import { useCallback, useContext, useEffect, useState } from "react";
import "./settings-appearance.scss";
import { ThemeActions, ThemeCard, ThemePlaceholder } from "./index";
import type { Theme } from "@types";
import { ImportThemeModal } from "./modals/import-theme-modal";
import { settingsContext } from "@renderer/context";

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

  const { clearTheme } = useContext(settingsContext);

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
    if (appearance.theme && appearance.authorId && appearance.authorName) {
      setIsImportThemeModalVisible(true);
      setImportTheme({
        theme: appearance.theme,
        authorId: appearance.authorId,
        authorName: appearance.authorName,
      });
    }
  }, [appearance.theme, appearance.authorId, appearance.authorName]);

  const onThemeImported = useCallback(() => {
    setIsImportThemeModalVisible(false);
    loadThemes();
  }, [clearTheme, loadThemes]);

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
