import { useId } from "react";
import * as styles from "./radio-field.css";
import { DotFillIcon } from "@primer/octicons-react";

export interface RadioFieldProps
  extends React.DetailedHTMLProps<
      React.InputHTMLAttributes<HTMLInputElement>,
      HTMLInputElement
  > {
  label: string;
}

export function RadioField({ label, ...props }: RadioFieldProps) {
  const id = useId();

  return (
      <div className={styles.radioField}>
        <div className={styles.radio}>
          <input
            id={id}
            type="radio"
            className={styles.radioInput}
            {...props}
          />
          {props.checked && <DotFillIcon />}
        </div>
        <label htmlFor={id} className={styles.radioLabel}>
            {label}
        </label>
      </div>
    );
}
