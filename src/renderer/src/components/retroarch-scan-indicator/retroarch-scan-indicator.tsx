import { useTranslation } from "react-i18next";

import { useRetroArchScan } from "@renderer/hooks";

import { ClassicsSpinner } from "../classics-spinner/classics-spinner";

import "../classics-scan-indicator/classics-scan-indicator.scss";

interface Props {
  variant?: "panel" | "section";
}

export function RetroArchScanIndicator({ variant = "panel" }: Readonly<Props>) {
  const { t } = useTranslation("settings");
  const { scan, openModal } = useRetroArchScan();

  if (!scan.active || scan.modalVisible) return null;

  const percent = Math.round(scan.percent);

  return (
    <button
      type="button"
      className={`classics-scan-indicator classics-scan-indicator--${variant}`}
      onClick={openModal}
    >
      <ClassicsSpinner size={13} />
      <span className="classics-scan-indicator__label">
        {t("scanning_system_label", { system: "RetroArch" })}
      </span>
      <span className="classics-scan-indicator__percent">{percent}%</span>
    </button>
  );
}
