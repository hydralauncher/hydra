import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ClockIcon,
  CheckCircleFillIcon,
  SyncIcon,
} from "@primer/octicons-react";

import { Button } from "@renderer/components";
import type { EmulatorConfig } from "@types";

interface Props {
  config: EmulatorConfig;
  systemLabel: string;
  onFirmwareStatusChange: (installed: boolean) => void;
}

export function SetupStepFirmware({
  config,
  systemLabel,
  onFirmwareStatusChange,
}: Readonly<Props>) {
  const { t } = useTranslation("settings");
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);

  const probe = async () => {
    setChecking(true);
    try {
      const result = await window.electron.checkPs3Firmware(
        config.executablePath
      );
      setInstalled(result.installed);
      onFirmwareStatusChange(result.installed);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    probe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <h3 className="setup-modal__body-title">
        {t("setup_step_firmware", { system: systemLabel })}
      </h3>
      <div>
        <p className="setup-modal__body-intro" style={{ margin: 0 }}>
          {t("setup_firmware_intro_1")}
        </p>
        <p className="setup-modal__body-intro" style={{ margin: 0 }}>
          {t("setup_firmware_intro_2")}
        </p>
      </div>

      <div className="setup-modal__numbered-list">
        <div className="setup-modal__numbered-item">
          <span className="setup-modal__numbered-marker">1</span>
          <span className="setup-modal__numbered-text">
            {t("setup_firmware_step_1")}
          </span>
        </div>
        <div className="setup-modal__numbered-item">
          <span className="setup-modal__numbered-marker">2</span>
          <span className="setup-modal__numbered-text">
            {t("setup_firmware_step_2")}
          </span>
        </div>
      </div>

      <div
        className={`setup-modal__alert ${
          installed
            ? "setup-modal__alert--success"
            : "setup-modal__alert--neutral"
        }`}
        style={{ marginTop: "auto" }}
      >
        <div
          className={`setup-modal__row-icon ${
            installed
              ? "setup-modal__row-icon--success"
              : "setup-modal__row-icon--neutral"
          }`}
          style={{ width: 36, height: 36 }}
        >
          {installed ? (
            <CheckCircleFillIcon size={16} />
          ) : (
            <ClockIcon size={16} />
          )}
        </div>
        <div className="setup-modal__alert-text">
          <span className="setup-modal__alert-title">
            {installed
              ? t("setup_firmware_found")
              : t("setup_firmware_not_yet")}
          </span>
          <span className="setup-modal__alert-note">
            {installed
              ? t("setup_firmware_found_note")
              : t("setup_firmware_recheck_note")}
          </span>
        </div>
        <Button theme="primary" onClick={probe} disabled={checking}>
          <SyncIcon size={14} />
          <span>{t("setup_firmware_check_again")}</span>
        </Button>
      </div>
    </>
  );
}
