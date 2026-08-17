import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components";
import { useToast } from "@renderer/hooks/use-toast";
import SteamIcon from "@renderer/assets/launcher-icons/steam.svg?react";
export function SettingsSteamImport() {
  const { t } = useTranslation("settings");
  const { showSuccessToast, showErrorToast } = useToast();
  const [isImporting, setIsImporting] = useState(false);

  const importGamesToLibrary = async (
    games: { appId: string; title: string }[],
    setExecutable = false
  ) => {
    let importedCount = 0;
    for (const game of games) {
      await window.electron.addGameToLibrary("steam", game.appId, game.title);

      if (setExecutable) {
        await window.electron.updateExecutablePath(
          "steam",
          game.appId,
          `steam://rungameid/${game.appId}`
        );
      }
      importedCount++;
    }
    return importedCount;
  };

  const handleImportInstalled = async () => {
    setIsImporting(true);
    try {
      const games = await window.electron.importSteamGames();

      if (games.length === 0) {
        showErrorToast(t("No Steam games found to import"));
        return;
      }

      const importedCount = await importGamesToLibrary(games, true);

      showSuccessToast(
        t("Successfully imported {{count}} Steam games!", {
          count: importedCount,
        })
      );
    } catch (error) {
      showErrorToast(t("Failed to import Steam games"));
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="settings-context-integrations__card">
      <div className="settings-context-integrations__card-info">
        <h3 className="settings-context-integrations__card-title">
          <SteamIcon style={{ width: 20, height: 20, fill: "currentColor" }} />
          Steam
        </h3>
        <p className="settings-context-integrations__card-description">
          {t(
            "Automatically import games installed on your PC via Steam to launch them directly from Hydra."
          )}
        </p>
      </div>

      <div
        className="settings-context-integrations__card-actions"
        style={{ flexDirection: "column", gap: 16 }}
      >
        <div style={{ display: "flex", gap: 8 }}>
          <Button
            theme="outline"
            onClick={handleImportInstalled}
            disabled={isImporting}
          >
            {isImporting
              ? t("Importing...")
              : t("Import Installed", { defaultValue: "Importar Instalados" })}
          </Button>
        </div>
      </div>
    </div>
  );
}
