import React, { useId, useMemo, useState } from "react";
import type { RecipeVariants } from "@vanilla-extract/recipes";
import * as styles from "./text-field.css";
import { EyeClosedIcon, EyeIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";

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
  state?: NonNullable<RecipeVariants<typeof styles.textField>>["state"];
}

export function TextField({
  theme = "primary",
  label,
  hint,
  textFieldProps,
  containerProps,
  rightContent = null,
  state,
  ...props
}: TextFieldProps) {
  const id = useId();

  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  const { t } = useTranslation("forms");

  const showPasswordToggleButton = props.type === "password";

  const inputType = useMemo(() => {
    if (props.type === "password" && isPasswordVisible) return "text";
    return props.type ?? "text";
  }, [props.type, isPasswordVisible]);

  return (
    <div className={styles.textFieldContainer} {...containerProps}>
      {label && <label htmlFor={id}>{label}</label>}

      <div className={styles.textFieldWrapper}>
        <div
          className={styles.textField({ focused: isFocused, theme, state })}
          {...textFieldProps}
        >
          <input
            id={id}
            className={styles.textFieldInput({ readOnly: props.readOnly })}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            {...props}
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

      {hint && <small>{hint}</small>}
    </div>
  );
}
