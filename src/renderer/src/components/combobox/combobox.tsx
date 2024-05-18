import { faChevronDown, faChevronUp } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { RecipeVariants } from "@vanilla-extract/recipes";
import { useId } from "react";
import * as styles from "./combobox.css";
import "./combobox.style.css";

export interface ComboboxProps
  extends React.DetailedHTMLProps<
    React.InputHTMLAttributes<HTMLInputElement>,
    HTMLInputElement
  > {
  options?: { label: string; value: string }[];
  theme?: NonNullable<RecipeVariants<typeof styles.combobox>>["theme"];
  label?: string | React.ReactNode;
  hint?: string | React.ReactNode;
  containerProps?: React.DetailedHTMLProps<
    React.HTMLAttributes<HTMLDivElement>,
    HTMLDivElement
  >;
}

export function Combobox({
  theme = "primary",
  label,
  hint,
  containerProps,
  options,
  value,
  ...props
}: Readonly<ComboboxProps>) {
  const id = useId();

  return (
    <div className={styles.comboboxContainer} {...containerProps}>
      {label && <label htmlFor={id}>{label}</label>}

      <div className={`select_component ${styles.combobox({ theme })}`}>
        <input type="radio" name="option" />
        <FontAwesomeIcon
          className="toggle icon icon-arrow-down"
          icon={faChevronDown}
        />
        <FontAwesomeIcon
          className="toggle icon icon-arrow-up"
          icon={faChevronUp}
        />
        <span className="placeholder">{props.placeholder}</span>

        {options?.map((option) => (
          <label key={option.value} className="option">
            <input
              type="radio"
              name="option"
              value={option.value}
              checked={option.value === value}
              onChange={props?.onChange}
            />
            <span className={`${styles.comboboxOptions({ theme })} title`}>
              {option.label}
            </span>
          </label>
        ))}
      </div>

      {hint && <small>{hint}</small>}
    </div>
  );
}
