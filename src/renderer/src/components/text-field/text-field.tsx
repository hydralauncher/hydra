import React, { useId, useState } from "react";
import { EyeClosedIcon, EyeIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import cn from "classnames";
import "./text-field.scss";

export interface TextFieldProps
  extends React.DetailedHTMLProps<
    React.InputHTMLAttributes<HTMLInputElement>,
    HTMLInputElement
  > {
  theme?: "primary" | "dark";
  label?: string | React.ReactNode;
  hint?: string | React.ReactNode;
  textFieldProps?: React.DetailedHTMLProps<
    React.HTMLAttributes<HTMLDivElement>,
    HTMLDivElement
  >;
  containerProps?: React.DetailedHTMLProps<
    React.HTMLAttributes<HTMLDivElement>,
    HTMLDivElement
  >;
  rightContent?: React.ReactNode | null;
  error?: string | React.ReactNode;
}

export const TextField = React.forwardRef<HTMLInputElement, TextFieldProps>(
  (
    {
      theme = "primary",
      label,
      hint,
      textFieldProps,
      containerProps,
      rightContent = null,
      error,
      ...props
    },
    ref
  ) => {
    const id = useId();
    const [isFocused, setIsFocused] = useState(false);
    const [isPasswordVisible, setIsPasswordVisible] = useState(false);
    const { t } = useTranslation("forms");
    const showPasswordToggleButton = props.type === "password";
    const inputType =
      props.type === "password" && isPasswordVisible
        ? "text"
        : (props.type ?? "text");
    const hintContent = error ? (
      <small className="text-field-container__error-label">{error}</small>
    ) : hint ? (
      <small>{hint}</small>
    ) : null;
    const handleFocus: React.FocusEventHandler<HTMLInputElement> = (event) => {
      setIsFocused(true);
      props.onFocus?.(event);
    };
    const handleBlur: React.FocusEventHandler<HTMLInputElement> = (event) => {
      setIsFocused(false);
      props.onBlur?.(event);
    };
    const hasError = !!error;
    return (
      <div className="text-field-container" {...containerProps}>
        {label && <label htmlFor={id}>{label}</label>}
        <div className="text-field-container__text-field-wrapper">
          <div
            className={cn(
              "text-field-container__text-field",
              `text-field-container__text-field--${theme}`,
              {
                "text-field-container__text-field--has-error": hasError,
                "text-field-container__text-field--focused": isFocused,
              }
            )}
            {...textFieldProps}
          >
            <input
              ref={ref}
              id={id}
              className={cn("text-field-container__text-field-input", {
                "text-field-container__text-field-input--read-only":
                  props.readOnly,
              })}
              {...props}
              onFocus={handleFocus}
              onBlur={handleBlur}
              type={inputType}
            />
            {showPasswordToggleButton && (
              <button
                type="button"
                className="text-field-container__toggle-password-button"
                onClick={() => setIsPasswordVisible(!isPasswordVisible)}
                aria-label={t("toggle_password_visibility")}
              >
                {isPasswordVisible ? (
                  <EyeClosedIcon size={16} />
                ) : (
                  <EyeIcon size={16} />
                )}
              </button>
            )}
          </div>
          {rightContent}
        </div>
        {hintContent}
      </div>
    );
  }
);
TextField.displayName = "TextField";
