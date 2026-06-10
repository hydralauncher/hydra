import stepOnePng from "@renderer/assets/emulation/onboarding-modal/Modal body.png";
import stepTwoPng from "@renderer/assets/emulation/onboarding-modal/Modal body-2.png";
import stepThreePng from "@renderer/assets/emulation/onboarding-modal/Modal body-1.png";

export function StepOneIllustration() {
  return (
    <div className="classics-onboarding__illustration">
      <img
        src={stepOnePng}
        alt=""
        className="classics-onboarding__illustration-img"
        draggable={false}
      />
    </div>
  );
}

export function StepTwoIllustration() {
  return (
    <div className="classics-onboarding__illustration">
      <img
        src={stepTwoPng}
        alt=""
        className="classics-onboarding__illustration-img"
        draggable={false}
      />
    </div>
  );
}

export function StepThreeIllustration() {
  return (
    <div className="classics-onboarding__illustration">
      <img
        src={stepThreePng}
        alt=""
        className="classics-onboarding__illustration-img"
        draggable={false}
      />
    </div>
  );
}
