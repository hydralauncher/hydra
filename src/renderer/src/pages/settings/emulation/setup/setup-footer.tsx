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
  showSkip: boolean;
  continueDisabled: boolean;
  continueHidden?: boolean;
  endAction?: FooterEndAction | null;
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
  endAction,
  onBack,
  onSkip,
  onContinue,
}: Readonly<SetupFooterProps>) {
  const { t } = useTranslation("settings");

  const backAction: FooterEndAction | null = showBack
    ? { label: t("setup_back"), onClick: onBack }
    : null;
  const leadingAction = endAction ?? backAction;

  return (
    <div className="setup-modal__footer">
      <div className="setup-modal__footer-side">
        {leadingAction && (
          <Button theme="outline" onClick={leadingAction.onClick}>
            {leadingAction.label}
          </Button>
        )}
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
          <Button theme="outline" onClick={onSkip}>
            {t("setup_skip")}
          </Button>
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
