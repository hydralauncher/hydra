import { useTranslation } from "react-i18next";
import { CheckCircleFillIcon, AlertIcon } from "@primer/octicons-react";

import type { EmulatorConfig } from "@types";

import { KNOWN_BINARY_LABELS } from "../known-binary-labels";

interface Props {
  config: EmulatorConfig;
  onBrowse: () => void;
}

export function SetupStepFindEmulator({ config, onBrowse }: Readonly<Props>) {
  const { t } = useTranslation("settings");
  const name = KNOWN_BINARY_LABELS[config.binary];
  const found = config.executablePath !== null;

  return (
    <>
      <h3 className="setup-modal__body-title">
        {t("setup_step_find_emulator", { name })}
      </h3>
      <p className="setup-modal__body-intro">
        {t("setup_step_find_intro", { name })}
      </p>

      <div className="setup-modal__row-card">
        <div
          className={`setup-modal__row-icon ${
            found
              ? "setup-modal__row-icon--success"
              : "setup-modal__row-icon--warn"
          }`}
        >
          {found ? <CheckCircleFillIcon size={18} /> : <AlertIcon size={18} />}
        </div>
        <div className="setup-modal__row-text">
          <div className="setup-modal__row-heading">
            <span className="setup-modal__row-title">
              {found
                ? t("setup_emulator_found", { name })
                : t("setup_emulator_not_found", { name })}
            </span>
            {config.detectedVersion && (
              <span className="setup-modal__row-version">
                v{config.detectedVersion}
              </span>
            )}
          </div>
          <span className="setup-modal__row-path">
            {config.executablePath ?? t("setup_emulator_not_found_hint")}
          </span>
        </div>
      </div>

      <div className="setup-modal__hint">
        <span>{t("setup_browse_manually_q")}</span>
        <button
          type="button"
          className="setup-modal__link-button"
          onClick={onBrowse}
        >
          {t("setup_browse_manually")}
        </button>
      </div>
    </>
  );
}
