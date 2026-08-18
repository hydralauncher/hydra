import { Toggle, CheckboxField } from "@renderer/components";
import { useTranslation } from "react-i18next";
import type { UserPreferences } from "@types";

interface SettingsDownloadSourcesAutoOptionsProps {
  userPreferences: UserPreferences | null;
  updateUserPreferences: (
    values: Partial<UserPreferences>
  ) => Promise<void> | void;
}

export function SettingsDownloadSourcesAutoOptions({
  userPreferences,
  updateUserPreferences,
}: Readonly<SettingsDownloadSourcesAutoOptionsProps>) {
  const { t } = useTranslation("settings");

  return (
    <div className="settings-download-sources__auto-options">
      <div className="settings-download-sources__option-row">
        <div className="settings-download-sources__option-info">
          <span className="settings-download-sources__option-title">
            {t("auto_download_by_source_priority", {
              defaultValue: "Baixar automaticamente por prioridade de fonte",
            })}
          </span>
          <span className="settings-download-sources__option-desc">
            {t("auto_download_by_source_priority_description", {
              defaultValue:
                "Seleciona automaticamente a última versão da fonte com maior prioridade ao clicar em baixar.",
            })}
          </span>
        </div>
        <Toggle
          checked={Boolean(userPreferences?.autoDownloadBySourcePriority)}
          onChange={(checked) =>
            updateUserPreferences({ autoDownloadBySourcePriority: checked })
          }
        />
      </div>

      <div className="settings-download-sources__checkboxes">
        <CheckboxField
          label={t("always_auto_extract", {
            defaultValue:
              "Sempre extrair o jogo automaticamente após o download",
          })}
          checked={
            userPreferences?.alwaysAutoExtract ??
            userPreferences?.extractFilesByDefault ??
            true
          }
          onChange={(e) =>
            updateUserPreferences({
              alwaysAutoExtract: e.target.checked,
              extractFilesByDefault: e.target.checked,
            })
          }
        />

        <CheckboxField
          label={t("always_delete_archive_after_extraction", {
            defaultValue:
              "Sempre excluir o arquivo compactado (RAR/ZIP) após extrair o jogo",
          })}
          checked={
            userPreferences?.alwaysDeleteArchiveAfterExtraction ??
            userPreferences?.deleteArchiveFilesAfterExtractionByDefault ??
            false
          }
          onChange={(e) =>
            updateUserPreferences({
              alwaysDeleteArchiveAfterExtraction: e.target.checked,
              deleteArchiveFilesAfterExtractionByDefault: e.target.checked,
            })
          }
        />
      </div>
    </div>
  );
}
