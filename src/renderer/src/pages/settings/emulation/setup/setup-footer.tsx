import { useTranslation } from "react-i18next";

import { Button } from "@renderer/components";

interface FooterEndAction {
  label: string;
  onClick: () => void;
}

interface SetupFooterProps {
  currentStepIndex: number;
  totalSteps: number;
  showBack: boolean;
  showCancel: boolean;
  showSkip: boolean;
  continueDisabled: boolean;
  continueHidden?: boolean;
  endAction?: FooterEndAction | null;
  onBack: () => void;
  onCancel: () => void;
  onSkip: () => void;
  onContinue: () => void;
}

export function SetupFooter({
  currentStepIndex,
  totalSteps,
  showBack,
  showCancel,
  showSkip,
  continueDisabled,
  continueHidden,
  endAction,
  onBack,
  onCancel,
  onSkip,
  onContinue,
}: Readonly<SetupFooterProps>) {
  const { t } = useTranslation("settings");

  return (
    <div className="setup-modal__footer">
      <div className="setup-modal__footer-side">
        {showBack ? (
          <button
            type="button"
            className="setup-modal__ghost-button"
            onClick={onBack}
          >
            {t("setup_back")}
          </button>
        ) : showCancel ? (
          <button
            type="button"
            className="setup-modal__ghost-button"
            onClick={onCancel}
          >
            {t("setup_cancel")}
          </button>
        ) : endAction ? (
          <button
            type="button"
            className="setup-modal__ghost-button"
            onClick={endAction.onClick}
          >
            {endAction.label}
          </button>
        ) : null}
      </div>

      <div className="setup-modal__dots">
        {Array.from({ length: totalSteps }).map((_, i) => (
          <span
            key={i}
            className={`setup-modal__dot ${
              i <= currentStepIndex ? "setup-modal__dot--active" : ""
            }`}
          />
        ))}
      </div>

      <div className="setup-modal__footer-side setup-modal__footer-side--end">
        {showSkip && (
          <button
            type="button"
            className="setup-modal__ghost-button"
            onClick={onSkip}
          >
            {t("setup_skip")}
          </button>
        )}
        {!continueHidden && (
          <Button
            theme="primary"
            onClick={onContinue}
            disabled={continueDisabled}
          >
            {t("setup_continue")}
          </Button>
        )}
      </div>
    </div>
  );
}
