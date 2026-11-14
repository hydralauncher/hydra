import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ClockIcon,
  CheckCircleFillIcon,
  FileDirectoryIcon,
  GlobeIcon,
  LinkExternalIcon,
  SyncIcon,
} from "@primer/octicons-react";

import { Button } from "@renderer/components";
import type { EmulatorConfig } from "@types";

import { firmwareGuideUrl } from "./ps-firmware-url";

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
  const { t, i18n } = useTranslation("settings");
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [firmwarePath, setFirmwarePath] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const isPs4 = config.system === "ps4";
  const copyKey = (name: string) =>
    isPs4 ? `setup_firmware_ps4_${name}` : `setup_firmware_${name}`;
  const missingTitleKey = isPs4
    ? "setup_firmware_ps4_not_found"
    : "setup_firmware_not_yet";

  const probe = async () => {
    setChecking(true);
    try {
      const result = await window.electron.checkEmulatorFirmware(
        config.system,
        config.executablePath
      );
      setInstalled(result.installed);
      setFirmwarePath(result.path);
      onFirmwareStatusChange(isPs4 || result.installed);
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
        {isPs4
          ? t("setup_firmware_ps4_title")
          : t("setup_step_firmware", { system: systemLabel })}
      </h3>
      <div>
        <p className="setup-modal__body-intro" style={{ margin: 0 }}>
          {t(copyKey("intro_1"))}
        </p>
        <p className="setup-modal__body-intro" style={{ margin: 0 }}>
          {t(copyKey("intro_2"))}
        </p>
      </div>

      <div className="setup-modal__numbered-list">
        <div className="setup-modal__numbered-item">
          <span className="setup-modal__numbered-marker">1</span>
          <span className="setup-modal__numbered-text">
            {t(copyKey("step_1"))}
          </span>
        </div>
        <div className="setup-modal__numbered-item">
          <span className="setup-modal__numbered-marker">2</span>
          <span className="setup-modal__numbered-text">
            {t(copyKey("step_2"))}
          </span>
        </div>
      </div>

      {isPs4 && firmwarePath && (
        <div className="setup-modal__hint">
          <button
            type="button"
            className="setup-modal__website-link"
            onClick={() => window.electron.openFolder(firmwarePath)}
          >
            <FileDirectoryIcon size={14} />
            <span>{firmwarePath}</span>
          </button>
        </div>
      )}

      <div className="setup-modal__hint">
        <button
          type="button"
          className="setup-modal__website-link"
          onClick={() =>
            window.electron.openExternal(
              firmwareGuideUrl(config.system, i18n.language)
            )
          }
        >
          <GlobeIcon size={14} />
          <span>{t(copyKey("guide"))}</span>
          <LinkExternalIcon size={12} />
        </button>
      </div>

      {installed !== null && (
        <div
          className="setup-modal__alert setup-modal__alert--neutral"
          style={{ marginTop: "auto" }}
        >
          <div
            className={`setup-modal__row-icon ${
              installed
                ? "setup-modal__row-icon--found"
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
              {installed ? t("setup_firmware_found") : t(missingTitleKey)}
            </span>
            <span className="setup-modal__alert-note">
              {installed
                ? t(copyKey("found_note"))
                : t(copyKey("recheck_note"))}
            </span>
          </div>
          {!installed && (
            <Button theme="primary" onClick={probe} disabled={checking}>
              <SyncIcon size={14} />
              <span>{t("setup_firmware_check_again")}</span>
            </Button>
          )}
        </div>
      )}
    </>
  );
}
