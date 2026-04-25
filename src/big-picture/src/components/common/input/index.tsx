import "./styles.scss";

import cn from "classnames";
import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  useId,
} from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    type = "text",
    placeholder = "Placeholder",
    label,
    hint,
    error = false,
    disabled = false,
    iconLeft,
    iconRight,
    className,
    ...props
  },
  ref
) {
  const generatedId = useId();
  const inputId = props.id ?? generatedId;

  return (
    <div className="input-container">
      {label && (
        <label
          htmlFor={inputId}
          className="typography typography--body input-label"
        >
          {label}
        </label>
      )}
      <div className="input-wrapper">
        <input
          ref={ref}
          id={inputId}
          type={type}
          placeholder={placeholder}
          disabled={disabled}
          data-icon-left={iconLeft ? "true" : undefined}
          data-icon-right={iconRight ? "true" : undefined}
          className={cn(
            "input",
            {
              "input--error": error,
              "input--disabled": disabled,
            },
            className
          )}
          {...props}
        />
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
});
