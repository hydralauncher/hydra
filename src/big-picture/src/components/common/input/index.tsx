import "./styles.scss";

import cn from "classnames";
import { Typography } from "../typography";
import type { InputHTMLAttributes, ReactNode } from "react";
import { FocusItem } from "..";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
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
        <Typography variant="label" className="input-label">
          {label}
        </Typography>
      )}
      <div className="input-wrapper">
        <FocusItem asChild>
          <input
            id="input"
            type={type}
            placeholder={placeholder}
            disabled={disabled}
            data-icon-left={iconLeft ? "true" : undefined}
            data-icon-right={iconRight ? "true" : undefined}
            className={`input ${error ? "input--error" : ""} ${
              disabled ? "input--disabled" : ""
            }`}
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
        <p className={cn("input-hint", { "input-hint--error": error })}>
          {hint}
        </p>
      )}
    </div>
  );
}
