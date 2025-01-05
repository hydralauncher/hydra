import React, { useId, useMemo, useState } from "react";
import type { RecipeVariants } from "@vanilla-extract/recipes";
import { EyeClosedIcon, EyeIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";

import * as styles from "./text-field.css";

export interface TextFieldProps
  extends React.DetailedHTMLProps<
    React.InputHTMLAttributes<HTMLInputElement>,
    HTMLInputElement
  > {
  theme?: NonNullable<RecipeVariants<typeof styles.textField>>["theme"];
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

    const inputType = useMemo(() => {
      if (props.type === "password" && isPasswordVisible) return "text";
      return props.type ?? "text";
    }, [props.type, isPasswordVisible]);

    const hintContent = useMemo(() => {
      if (error) return <small className={styles.errorLabel}>{error}</small>;

      if (hint) return <small>{hint}</small>;
      return null;
    }, [hint, error]);

    const handleFocus: React.FocusEventHandler<HTMLInputElement> = (event) => {
      setIsFocused(true);
      if (props.onFocus) props.onFocus(event);
    };

    const handleBlur: React.FocusEventHandler<HTMLInputElement> = (event) => {
      setIsFocused(false);
      if (props.onBlur) props.onBlur(event);
    };

    const hasError = !!error;

    return (
      <div className={styles.textFieldContainer} {...containerProps}>
        {label && <label htmlFor={id}>{label}</label>}

        <div className={styles.textFieldWrapper}>
          <div
            className={styles.textField({
              theme,
              hasError,
              focused: isFocused,
            })}
            {...textFieldProps}
          >
            <input
              ref={ref}
              id={id}
              className={styles.textFieldInput({ readOnly: props.readOnly })}
              {...props}
              onFocus={handleFocus}
              onBlur={handleBlur}
              type={inputType}
            />

            {showPasswordToggleButton && (
              <button
                type="button"
                className={styles.togglePasswordButton}
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
