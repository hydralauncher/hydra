import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { DeviceDesktopIcon } from "@primer/octicons-react";

import { Modal } from "../modal/modal";
import { Button } from "../button/button";
import { CheckboxField } from "../checkbox-field/checkbox-field";
import { ClassicsIcon } from "@renderer/pages/library/category-filter";

import "../classics-onboarding-modal/classics-onboarding-modal.scss";
import "./recompilation-onboarding-modal.scss";

const STORAGE_KEY = "hydra-recompilation-onboarding-dismissed";

export const hasDismissedRecompilationOnboarding = () =>
  localStorage.getItem(STORAGE_KEY) === "true";

export interface RecompilationOnboardingModalProps {
  visible: boolean;
  onClose: () => void;
  onShowRecompilations: () => void;
}

function CatalogueFilterIllustration() {
  const { t } = useTranslation("catalogue");

  return (
    <div className="recompilation-onboarding__stage" aria-hidden="true">
      <span className="recompilation-onboarding__chip">
        <i />
        {t("recompilations_filter")}
      </span>
      <span className="recompilation-onboarding__card recompilation-onboarding__card--highlighted recompilation-onboarding__card--a">
        <i className="recompilation-onboarding__badge" />
      </span>
      <span className="recompilation-onboarding__card recompilation-onboarding__card--dimmed recompilation-onboarding__card--b" />
      <span className="recompilation-onboarding__card recompilation-onboarding__card--dimmed recompilation-onboarding__card--c" />
      <span className="recompilation-onboarding__card recompilation-onboarding__card--dimmed recompilation-onboarding__card--d" />
      <span className="recompilation-onboarding__card recompilation-onboarding__card--highlighted recompilation-onboarding__card--e">
        <i className="recompilation-onboarding__badge" />
      </span>
      <span className="recompilation-onboarding__card recompilation-onboarding__card--dimmed recompilation-onboarding__card--f" />

      <div className="recompilation-onboarding__mode-toggle">
        <span>
          <DeviceDesktopIcon size={8} />
          {t("mode_modern_games")}
        </span>
        <span className="recompilation-onboarding__mode-toggle-active">
          <ClassicsIcon size={9} />
          {t("mode_classics")}
        </span>
      </div>

      <div className="recompilation-onboarding__filter-row" />
      <span className="recompilation-onboarding__filter-orb" />
      <span className="recompilation-onboarding__filter-label">
        {t("recompilations_filter")}
      </span>
      <span className="recompilation-onboarding__switch">
        <i />
      </span>

      <div className="recompilation-onboarding__section recompilation-onboarding__section--platforms">
        <div className="recompilation-onboarding__section-header">
          <span className="recompilation-onboarding__section-orb recompilation-onboarding__section-orb--platforms" />
          {t("platforms")}
        </div>
        <div className="recompilation-onboarding__section-body">
          <span>
            <i />
            Sony Playstation 2
          </span>
          <span>
            <i />
            Nintendo 64
          </span>
        </div>
      </div>
      <div className="recompilation-onboarding__section recompilation-onboarding__section--genres">
        <div className="recompilation-onboarding__section-header">
          <span className="recompilation-onboarding__section-orb recompilation-onboarding__section-orb--genres" />
          {t("genres")}
        </div>
      </div>

      <span className="recompilation-onboarding__ripple" />
      <svg
        className="recompilation-onboarding__cursor"
        width="16"
        height="20"
        viewBox="0 0 16 20"
      >
        <path
          d="M1.5 1.5v14.2l3.9-3.6 2.6 6 2.3-1-2.6-5.9h5.4z"
          fill="#f5f5f5"
          stroke="#0d0d0d"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

export function RecompilationOnboardingModal({
  visible,
  onClose,
  onShowRecompilations,
}: Readonly<RecompilationOnboardingModalProps>) {
  const { t } = useTranslation("recompilation_onboarding");
  const [dontShowAgain, setDontShowAgain] = useState(true);

  useEffect(() => {
    if (visible) setDontShowAgain(true);
  }, [visible]);

  const handleClose = () => {
    if (dontShowAgain) localStorage.setItem(STORAGE_KEY, "true");
    onClose();
  };

  const handleShowRecompilations = () => {
    handleClose();
    onShowRecompilations();
  };

  return (
    <Modal
      visible={visible}
      title={t("title")}
      onClose={handleClose}
      noContentPadding
    >
      <div className="classics-onboarding">
        <div className="classics-onboarding__body">
          <CatalogueFilterIllustration />
        </div>

        <div className="classics-onboarding__footer">
          <div className="classics-onboarding__copy">
            <h4 className="classics-onboarding__heading">{t("heading")}</h4>
            <p className="classics-onboarding__paragraph">{t("body")}</p>
          </div>

          <div className="classics-onboarding__actions">
            <CheckboxField
              label={t("dont_show_again")}
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
            />

            <Button theme="primary" onClick={handleShowRecompilations}>
              {t("show_recompilations")}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
