import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckboxField } from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useAppSelector } from "@renderer/hooks";
import type { UserPreferences } from "@types";
import "./settings-folder-configuration.scss";

export function SettingsFolderConfiguration() {
  const { t } = useTranslation("settings");
  const { updateUserPreferences } = useContext(settingsContext);

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const [form, setForm] = useState({
    showGameCountInFolders: true,
    showGamesInBothFoldersAndLibrary: true,
  });

  useEffect(() => {
    if (userPreferences) {
      setForm({
        showGameCountInFolders: userPreferences.showGameCountInFolders ?? true,
        showGamesInBothFoldersAndLibrary:
          userPreferences.showGamesInBothFoldersAndLibrary ?? true,
      });
    }
  }, [userPreferences]);

  const handleChange = (values: Partial<UserPreferences>) => {
    updateUserPreferences(values);
  };

  return (
    <div className="settings-folder-configuration settings-section">
      <div className="settings-folder-configuration__option">
        <CheckboxField
          label={t("show_game_count_in_folders")}
          checked={form.showGameCountInFolders}
          onChange={(event) => {
            const showGameCountInFolders = event.target.checked;
            setForm((prev) => ({ ...prev, showGameCountInFolders }));
            handleChange({ showGameCountInFolders });
          }}
        />
      </div>

      <div className="settings-folder-configuration__option">
        <CheckboxField
          label={t("show_games_in_both_folders_and_library")}
          checked={form.showGamesInBothFoldersAndLibrary}
          onChange={(event) => {
            const showGamesInBothFoldersAndLibrary = event.target.checked;
            setForm((prev) => ({ ...prev, showGamesInBothFoldersAndLibrary }));
            handleChange({ showGamesInBothFoldersAndLibrary });
          }}
        />
      </div>
    </div>
  );
}
