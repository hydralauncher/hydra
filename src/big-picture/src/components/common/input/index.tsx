import { Typography } from "../typography";
import cn from "classnames";
import "./style.scss";
import { FocusItem } from "..";

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
    <div className="input-container">
      {label && (
        <Typography
          variant="label"
          // htmlFor="input"
          className="input-label"
        >
          {label}
        </Typography>
      )}
      <div className="input-wrapper">
        <FocusItem>
          <input
            id="input"
            type={type}
            placeholder={placeholder}
            disabled={disabled}
            data-icon-left={iconLeft ? "true" : undefined}
            data-icon-right={iconRight ? "true" : undefined}
            className={cn("input", {
              "input--error": error,
              "input--disabled": disabled,
            })}
            {...props}
          />
        </FocusItem>
        {iconLeft && (
          <div className="input-icon input-icon--left">{iconLeft}</div>
        )}
        {iconRight && (
          <div className="input-icon input-icon--right">{iconRight}</div>
        )}
      </div>
      {hint && (
        <p
          className={cn("input-hint", {
            "input-hint--error": error,
          })}
        >
          {hint}
        </p>
      )}
    </div>
  );
}
