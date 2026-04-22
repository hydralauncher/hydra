import { Typography } from "../typography";
import cn from "classnames";
import "./style.scss";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: boolean;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
}

export function Input({
  type = "text",
  placeholder = "Placeholder",
  label,
  hint,
  error = false,
  disabled = false,
  iconLeft,
  iconRight,
  ...props
}: Readonly<InputProps>) {
  return (
    <div className="bp-input-container">
      {label && (
        <Typography
          variant="label"
          // htmlFor="input"
          className="bp-input-label"
        >
          {label}
        </Typography>
      )}
      <div className="bp-input-wrapper">
        <input
          id="input"
          type={type}
          placeholder={placeholder}
          disabled={disabled}
          data-icon-left={iconLeft ? "true" : undefined}
          data-icon-right={iconRight ? "true" : undefined}
          className={cn("bp-input", {
            "bp-input--error": error,
            "bp-input--disabled": disabled,
          })}
          {...props}
        />
        {iconLeft && (
          <div className="bp-input-icon bp-input-icon--left">{iconLeft}</div>
        )}
        {iconRight && (
          <div className="bp-input-icon bp-input-icon--right">{iconRight}</div>
        )}
      </div>
      {hint && (
        <p
          className={cn("bp-input-hint", {
            "bp-input-hint--error": error,
          })}
        >
          {hint}
        </p>
      )}
    </div>
  );
}
