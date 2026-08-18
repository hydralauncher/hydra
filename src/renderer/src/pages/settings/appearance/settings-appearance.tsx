import { useCallback, useContext, useEffect, useState } from "react";
import "./settings-appearance.scss";
import {
  ThemeActions,
  ThemeCard,
  ThemePlaceholder,
  ThemeCustomizer,
} from "./index";
import type { Theme } from "@types";
import { ImportThemeModal } from "./modals/import-theme-modal";
import { settingsContext } from "@renderer/context";
import { useNavigate } from "react-router-dom";
import { levelDBService } from "@renderer/services/leveldb.service";
import { useTranslation } from "react-i18next";
import { restoreCustomThemeOnBoot } from "@renderer/services/theme-customizer.service";
import {
  getSavedCustomThemes,
  deleteSavedCustomTheme,
  applyCustomTheme,
  type SavedCustomTheme,
} from "@renderer/services/theme-customizer.service";
import { TrashIcon } from "@primer/octicons-react";

interface SettingsAppearanceProps {
  appearance: {
    theme: string | null;
    authorId: string | null;
    authorName: string | null;
  };
}

type ThemeTab = "themes" | "customize";

export function SettingsAppearance({
  appearance,
}: Readonly<SettingsAppearanceProps>) {
  const [themes, setThemes] = useState<Theme[]>([]);
  const [savedCustomThemes, setSavedCustomThemes] = useState<
    SavedCustomTheme[]
  >([]);
  const [activeTab, setActiveTab] = useState<ThemeTab>("themes");
  const [isImportThemeModalVisible, setIsImportThemeModalVisible] =
    useState(false);
  const [importTheme, setImportTheme] = useState<{
    theme: string;
    authorId: string;
    authorName: string;
  } | null>(null);
  const [hasShownModal, setHasShownModal] = useState(false);

  const { t } = useTranslation("settings");
  const { clearTheme } = useContext(settingsContext);
  const navigate = useNavigate();

  const loadThemes = useCallback(async () => {
    const themesList = (await levelDBService.values("themes")) as Theme[];
    setThemes(themesList);
  }, []);

  const loadSavedCustomThemes = useCallback(() => {
    setSavedCustomThemes(getSavedCustomThemes());
  }, []);

  useEffect(() => {
    loadThemes();
    loadSavedCustomThemes();
    restoreCustomThemeOnBoot();
  }, [loadThemes, loadSavedCustomThemes]);

  useEffect(() => {
    const unsubscribe = window.electron.onCustomThemeUpdated(() => {
      loadThemes();
    });
    return () => unsubscribe();
  }, [loadThemes]);

  useEffect(() => {
    if (
      appearance.theme &&
      appearance.authorId &&
      appearance.authorName &&
      !hasShownModal
    ) {
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

  const handleApplySaved = useCallback((t: SavedCustomTheme) => {
    applyCustomTheme(t.config);
  }, []);

  const handleDeleteSaved = useCallback(
    (i: number) => {
      deleteSavedCustomTheme(i);
      loadSavedCustomThemes();
    },
    [loadSavedCustomThemes]
  );

  const sortedThemes = [...themes].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  const totalCount = sortedThemes.length + savedCustomThemes.length;

  const tabs: { id: ThemeTab; label: string; count: number }[] = [
    {
      id: "themes",
      label: t("my_themes", { defaultValue: "Temas" }),
      count: totalCount,
    },
    {
      id: "customize",
      label: "Personalizar",
      count: 0,
    },
  ];

  return (
    <div className="appearance-tabs">
      <div className="appearance-tabs__bar">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`appearance-tabs__tab ${activeTab === tab.id ? "appearance-tabs__tab--active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className="appearance-tabs__tab-count">{tab.count}</span>
            )}
          </button>
        ))}
      </div>

      <div className="settings-context-panel">
        <div className="settings-context-panel__group settings-appearance">
          {activeTab === "themes" && (
            <ThemeActions
              onListUpdated={loadThemes}
              themesCount={themes.length}
            />
          )}

          {activeTab === "customize" ? (
            <div className="settings-appearance__effects-container">
              <ThemeCustomizer onSaved={loadSavedCustomThemes} />
            </div>
          ) : (
            <>
              {/* ── Temas personalizados salvos ─────────────────── */}
              {savedCustomThemes.length > 0 && (
                <div className="settings-appearance__saved-custom">
                  <p className="settings-appearance__saved-custom-title">
                    Personalizados
                  </p>
                  <div className="settings-appearance__saved-custom-grid">
                    {savedCustomThemes.map((t, i) => (
                      <div
                        key={t.savedAt}
                        className="settings-appearance__saved-custom-card"
                      >
                        <span className="settings-appearance__saved-custom-name">
                          {t.name}
                        </span>
                        <div className="settings-appearance__saved-custom-actions">
                          <button
                            type="button"
                            className="settings-appearance__saved-apply-btn"
                            onClick={() => handleApplySaved(t)}
                          >
                            Aplicar
                          </button>
                          <button
                            type="button"
                            className="settings-appearance__saved-delete-btn"
                            aria-label="Remover tema"
                            onClick={() => handleDeleteSaved(i)}
                          >
                            <TrashIcon size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Temas CSS (LevelDB) ────────────────────────── */}
              <div className="settings-appearance__themes">
                {!sortedThemes.length && !savedCustomThemes.length ? (
                  <ThemePlaceholder onListUpdated={loadThemes} />
                ) : !sortedThemes.length ? null : (
                  sortedThemes.map((theme) => (
                    <ThemeCard
                      key={theme.id}
                      theme={theme}
                      onListUpdated={loadThemes}
                    />
                  ))
                )}
              </div>
            </>
          )}
        </div>

        {importTheme && (
          <ImportThemeModal
            visible={isImportThemeModalVisible}
            onClose={() => {
              setIsImportThemeModalVisible(false);
              clearTheme();
              setHasShownModal(false);
            }}
            onThemeImported={onThemeImported}
            themeName={importTheme.theme}
            authorId={importTheme.authorId}
            authorName={importTheme.authorName}
          />
        )}
      </div>
    </div>
  );
}
