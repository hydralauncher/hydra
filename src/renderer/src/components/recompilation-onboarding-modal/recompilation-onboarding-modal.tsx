import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDownIcon, DeviceDesktopIcon } from "@primer/octicons-react";
import cn from "classnames";

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

const GRID_CARDS = [36, 82, 128, 174].flatMap((top, row) => {
  const recompColumn = row % 3;
  return [32, 108, 184].map((left, column) => ({
    left,
    top,
    highlighted: column === recompColumn,
  }));
});

const COLLAPSED_SECTIONS = [
  { key: "platforms", top: 90, color: "#1c9749", count: 12, dimmed: true },
  { key: "genres", top: 126, color: "#7c3aed", count: 28, dimmed: true },
  { key: "tags", top: 160, color: "#e11d48", count: 447, dimmed: false },
];

function CatalogueFilterIllustration() {
  const { t } = useTranslation("catalogue");

  return (
    <div className="recompilation-onboarding__stage" aria-hidden="true">
      <span className="recompilation-onboarding__chip">
        <i />
        {t("recompilations_filter")}
      </span>
      {GRID_CARDS.map(({ highlighted, left, top }) => (
        <span
          key={`${left}-${top}`}
          className={cn("recompilation-onboarding__card", {
            "recompilation-onboarding__card--highlighted": highlighted,
            "recompilation-onboarding__card--dimmed": !highlighted,
          })}
          style={{ left, top }}
        >
          {highlighted && <i className="recompilation-onboarding__badge" />}
        </span>
      ))}
      <div className="recompilation-onboarding__grid-fade" />

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

      {COLLAPSED_SECTIONS.map(({ key, top, color, count, dimmed }) => (
        <div
          key={key}
          className={cn("recompilation-onboarding__section", {
            "recompilation-onboarding__section--dimmed": dimmed,
          })}
          style={{ top }}
        >
          <ChevronDownIcon size={7} />
          <span
            className="recompilation-onboarding__section-orb"
            style={{ backgroundColor: color }}
          />
          <span className="recompilation-onboarding__section-title">
            {t(key)}
          </span>
          <span className="recompilation-onboarding__section-count">
            {count}
          </span>
        </div>
      ))}

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
