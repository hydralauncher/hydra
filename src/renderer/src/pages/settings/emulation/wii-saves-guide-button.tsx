import { QuestionIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";

import "./wii-saves-guide-button.scss";

export function WiiSavesGuideButton() {
  const { t } = useTranslation("settings");

  return (
    <button
      type="button"
      className="wii-saves-guide-button"
      data-open-article="wii-saves"
      aria-label={t("wii_saves_guide")}
      title={t("wii_saves_guide")}
    >
      <QuestionIcon size={16} />
    </button>
  );
}
