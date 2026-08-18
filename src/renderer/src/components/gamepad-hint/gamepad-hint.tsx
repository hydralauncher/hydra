import "./gamepad-hint.scss";

interface GamepadHintProps {
  label: string;
  position?: "left" | "right";
}

export function GamepadHint({ label, position = "left" }: GamepadHintProps) {
  return (
    <span
      className={`gamepad-hint gamepad-hint--${position}`}
      aria-label={`Botão ${label}`}
    >
      {label}
    </span>
  );
}
