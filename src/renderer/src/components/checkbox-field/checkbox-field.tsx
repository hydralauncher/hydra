import { useId } from "react";
import * as styles from "./checkbox-field.css";
import { CheckIcon } from "@primer/octicons-react";

export interface CheckboxFieldProps
  extends React.DetailedHTMLProps<
    React.InputHTMLAttributes<HTMLInputElement>,
    HTMLInputElement
  > {
  label: string;
}

export function CheckboxField({ label, ...props }: CheckboxFieldProps) {
  const id = useId();

  return (
    <div className={styles.checkboxField}>
      <div className={styles.checkbox}>
        <input
          id={id}
          type="checkbox"
          className={styles.checkboxInput}
          {...props}
        />
        {props.checked && <CheckIcon />}
      </div>
      <label htmlFor={id} className={styles.checkboxLabel} tabIndex={0}>
        {label}
      </label>
    </div>
  );
}
