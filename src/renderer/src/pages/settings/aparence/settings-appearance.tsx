import { useEffect, useState } from "react";
import "./settings-appearance.scss";
import { ThemeActions, ThemeCard, ThemePlaceholder } from "./index";
import type { Theme } from "@types";
import { ImportThemeModal } from "./modals/import-theme-modal";

interface SettingsAppearanceProps {
  appearanceTheme: string | null;
  appearanceAuthorId: string | null;
  appearanceAuthorName: string | null;
}

export const SettingsAppearance = ({
  appearanceTheme,
  appearanceAuthorId,
  appearanceAuthorName,
}: SettingsAppearanceProps) => {
  const [themes, setThemes] = useState<Theme[]>([]);
  const [isImportThemeModalVisible, setIsImportThemeModalVisible] =
    useState(false);
  const [importTheme, setImportTheme] = useState<{
    theme: string;
    authorId: string;
    authorName: string;
  } | null>(null);

  const loadThemes = async () => {
    const themesList = await window.electron.getAllCustomThemes();
    setThemes(themesList);
  };

  useEffect(() => {
    loadThemes();
  }, []);

  useEffect(() => {
    const unsubscribe = window.electron.onCssInjected(() => {
      loadThemes();
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (appearanceTheme && appearanceAuthorId && appearanceAuthorName) {
      setIsImportThemeModalVisible(true);
      setImportTheme({
        theme: appearanceTheme,
        authorId: appearanceAuthorId,
        authorName: appearanceAuthorName,
      });
    }
  }, [appearanceTheme, appearanceAuthorId, appearanceAuthorName]);

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
          onClose={() => setIsImportThemeModalVisible(false)}
          onThemeImported={() => {
            setIsImportThemeModalVisible(false);
            loadThemes();
          }}
          themeName={importTheme.theme}
          authorId={importTheme.authorId}
          authorName={importTheme.authorName}
        />
      )}
    </div>
  );
};
