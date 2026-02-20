import type React from "react";
import { useId } from "react";
import cn from "classnames";

import "./radio-field.scss";

export interface RadioFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: React.ReactNode;
  className?: string;
  labelClassName?: string;
  leftSlot?: React.ReactNode;
  accentColor?: string;
}

export function RadioField({
  label,
  className,
  labelClassName,
  leftSlot,
  checked,
  accentColor = "var(--color-primary)",
  id,
  ...props
}: RadioFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <label
      htmlFor={inputId}
      className={cn("radio-field", className, {
        "radio-field--selected": checked,
      })}
      style={{ "--radio-field-accent": accentColor } as React.CSSProperties}
    >
      <input
        id={inputId}
        type="radio"
        className="radio-field__input"
        checked={checked}
        {...props}
      />
      <span className="radio-field__control" aria-hidden="true">
        <span className="radio-field__dot" />
      </span>
      {leftSlot ? (
        <span className="radio-field__left-slot">{leftSlot}</span>
      ) : null}
      <span className={cn("radio-field__label", labelClassName)}>{label}</span>
    </label>
  );
}
