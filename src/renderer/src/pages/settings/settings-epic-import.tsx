import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components";
import { useToast } from "@renderer/hooks/use-toast";
import EpicGamesIcon from "@renderer/assets/launcher-icons/epic-games.svg?react";

export function SettingsEpicImport() {
  const { t } = useTranslation("settings");
  const { showSuccessToast, showErrorToast } = useToast();
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const handleImport = async () => {
    setIsImporting(true);
    setProgress(null);

    try {
      setProgress(
        t("Scanning Epic manifests...", {
          defaultValue: "Escaneando jogos Epic...",
        })
      );
      const games = await window.electron.importEpicGames();

      if (games.length === 0) {
        showErrorToast(
          t("No Epic games found to import", {
            defaultValue: "Nenhum jogo Epic encontrado para importar",
          })
        );
        return;
      }

      let importedCount = 0;
      let errorCount = 0;

      for (const game of games) {
        setProgress(
          t("Importing {{title}}...", {
            title: game.title,
            defaultValue: `Importando ${game.title}...`,
          })
        );

        try {
          await window.electron.addGameToLibrary(
            "epic",
            game.appName,
            game.title
          );
          await window.electron.updateExecutablePath(
            "epic",
            game.appName,
            `com.epicgames.launcher://apps/${game.appName}?action=launch&silent=true`
          );
          importedCount++;
        } catch {
          errorCount++;
        }
      }

      if (importedCount > 0) {
        showSuccessToast(
          t("Successfully imported {{count}} Epic games!", {
            count: importedCount,
            defaultValue: `${importedCount} jogo(s) Epic importados com sucesso!`,
          })
        );
      }

      if (errorCount > 0) {
        showErrorToast(
          t("{{count}} game(s) failed to import", {
            count: errorCount,
            defaultValue: `${errorCount} jogo(s) falharam na importação`,
          })
        );
      }
    } catch {
      showErrorToast(
        t("Failed to import Epic games", {
          defaultValue: "Falha ao importar jogos Epic",
        })
      );
    } finally {
      setIsImporting(false);
      setProgress(null);
    }
  };

  return (
    <div className="settings-context-integrations__card">
      <div className="settings-context-integrations__card-info">
        <h3 className="settings-context-integrations__card-title">
          <EpicGamesIcon
            style={{ width: 20, height: 20, fill: "currentColor" }}
          />
          Epic Games
        </h3>
        <p className="settings-context-integrations__card-description">
          {isImporting && progress
            ? progress
            : t("import_epic_games_description", {
                defaultValue:
                  "Importe automaticamente jogos instalados via Epic Games para lançá-los direto pelo Hydra.",
              })}
        </p>
      </div>

      <div className="settings-context-integrations__card-actions">
        <Button theme="outline" onClick={handleImport} disabled={isImporting}>
          {isImporting
            ? t("Importing...", { defaultValue: "Importando..." })
            : t("Import", { defaultValue: "Importar" })}
        </Button>
      </div>
    </div>
  );
}
