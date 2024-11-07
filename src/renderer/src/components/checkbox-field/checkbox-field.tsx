import { useId } from "react";
import { CheckIcon } from "@primer/octicons-react";
import "./checkbox-field.scss";

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
    <div className="checkbox-field">
      <div className="checkbox-field__checkbox">
        <input
          id={id}
          type="checkbox"
          className="checkbox-field__input"
          {...props}
        />
        {props.checked && <CheckIcon />}
      </div>
      <label htmlFor={id} className="checkbox-field__label">
        {label}
      </label>
    </div>
  );
}
