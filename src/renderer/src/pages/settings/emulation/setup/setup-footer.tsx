import { useTranslation } from "react-i18next";

import { Button } from "@renderer/components";

interface SetupFooterProps {
  currentStepIndex: number;
  totalSteps: number;
  showBack: boolean;
  showSkip: boolean;
  continueDisabled: boolean;
  continueHidden?: boolean;
  onBack: () => void;
  onSkip: () => void;
  onContinue: () => void;
}

export function SetupFooter({
  currentStepIndex,
  totalSteps,
  showBack,
  showSkip,
  continueDisabled,
  continueHidden,
  onBack,
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
