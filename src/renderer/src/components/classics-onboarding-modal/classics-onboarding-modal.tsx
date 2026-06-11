import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Modal } from "../modal/modal";
import { CheckboxField } from "../checkbox-field/checkbox-field";
import {
  StepOneIllustration,
  StepThreeIllustration,
  StepTwoIllustration,
} from "./illustrations";

import "./classics-onboarding-modal.scss";

const STORAGE_KEY = "hydra-classics-onboarding-dismissed";
const STEP_COUNT = 3;

export const hasDismissedClassicsOnboarding = () =>
  localStorage.getItem(STORAGE_KEY) === "true";

export interface ClassicsOnboardingModalProps {
  visible: boolean;
  onClose: () => void;
}

interface StepContent {
  illustration: React.ReactNode;
  headingKey: string;
  bodyKey: string;
}

export function ClassicsOnboardingModal({
  visible,
  onClose,
}: Readonly<ClassicsOnboardingModalProps>) {
  const { t } = useTranslation("classics_onboarding");
  const [stepIndex, setStepIndex] = useState(0);
  const [dontShowAgain, setDontShowAgain] = useState(true);

  useEffect(() => {
    if (visible) {
      setStepIndex(0);
      setDontShowAgain(true);
    }
  }, [visible]);

  const handleClose = () => {
    if (dontShowAgain) localStorage.setItem(STORAGE_KEY, "true");
    onClose();
  };

  const handlePrimary = () => {
    if (stepIndex < STEP_COUNT - 1) {
      setStepIndex((i) => i + 1);
    } else {
      handleClose();
    }
  };

  const steps: StepContent[] = [
    {
      illustration: <StepOneIllustration />,
      headingKey: "step1_heading",
      bodyKey: "step1_body",
    },
    {
      illustration: <StepTwoIllustration />,
      headingKey: "step2_heading",
      bodyKey: "step2_body",
    },
    {
      illustration: <StepThreeIllustration />,
      headingKey: "step3_heading",
      bodyKey: "step3_body",
    },
  ];

  const current = steps[stepIndex];
  const isLastStep = stepIndex === STEP_COUNT - 1;

  return (
    <Modal
      visible={visible}
      title={t("title")}
      onClose={handleClose}
      noContentPadding
    >
      <div className="classics-onboarding">
        <div className="classics-onboarding__body">{current.illustration}</div>

        <div className="classics-onboarding__footer">
          <div className="classics-onboarding__copy">
            <h4 className="classics-onboarding__heading">
              {t(current.headingKey)}
            </h4>
            <p className="classics-onboarding__paragraph">
              {t(current.bodyKey)}
            </p>
          </div>

          <div className="classics-onboarding__actions">
            <CheckboxField
              label={t("dont_show_again")}
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
            />

            <div className="classics-onboarding__progress">
              {steps.map((step, i) => (
                <span
                  key={step.bodyKey}
                  className={
                    i <= stepIndex
                      ? "classics-onboarding__progress-pill classics-onboarding__progress-pill--active"
                      : "classics-onboarding__progress-pill"
                  }
                />
              ))}
            </div>

            <button
              type="button"
              className="classics-onboarding__primary"
              onClick={handlePrimary}
            >
              {isLastStep ? t("explore") : t("next")}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
