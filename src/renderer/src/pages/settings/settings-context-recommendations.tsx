import { useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { SelectField } from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useAppSelector } from "@renderer/hooks";
import type { UserPreferences } from "@types";

type SimilarGamesAlgorithm = NonNullable<
  UserPreferences["similarGamesAlgorithm"]
>;

export function SettingsContextRecommendations() {
  const { t } = useTranslation("settings");
  const { updateUserPreferences } = useContext(settingsContext);
  const preferences = useAppSelector((state) => state.userPreferences.value);
  const [algorithm, setAlgorithm] = useState<SimilarGamesAlgorithm>("balanced");

  useEffect(() => {
    setAlgorithm(preferences?.similarGamesAlgorithm ?? "balanced");
  }, [preferences?.similarGamesAlgorithm]);

  const options = useMemo(
    () =>
      (["balanced", "jaccard", "legacy"] as SimilarGamesAlgorithm[]).map(
        (value) => ({
          key: value,
          value,
          label: t(`recommendations_algorithm_${value}`),
        })
      ),
    [t]
  );

  return (
    <div className="settings-context-panel">
      <div className="settings-context-panel__group">
        <h3>{t("recommendations")}</h3>
        <p>{t("recommendations_algorithm_description")}</p>
        <SelectField
          label={t("recommendations_algorithm")}
          value={algorithm}
          onChange={(event) => {
            const value = event.target.value as SimilarGamesAlgorithm;
            setAlgorithm(value);
            updateUserPreferences({ similarGamesAlgorithm: value });
          }}
          options={options}
        />
      </div>
    </div>
  );
}
