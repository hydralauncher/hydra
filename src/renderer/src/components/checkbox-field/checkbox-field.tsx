import { useEffect, useId, useRef } from "react";
import { CheckIcon } from "@primer/octicons-react";
import "./checkbox-field.scss";

export interface CheckboxFieldProps
  extends React.DetailedHTMLProps<
    React.InputHTMLAttributes<HTMLInputElement>,
    HTMLInputElement
  > {
  label: string | React.ReactNode;
  indeterminate?: boolean;
}

export function CheckboxField({
  label,
  indeterminate = false,
  ...props
}: Readonly<CheckboxFieldProps>) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  const filled = props.checked || indeterminate;

  return (
    <div className="checkbox-field">
      <div
        className={`checkbox-field__checkbox ${filled ? "checked" : ""} ${
          indeterminate ? "checkbox-field__checkbox--indeterminate" : ""
        }`}
      >
        <input
          ref={inputRef}
          id={id}
          type="checkbox"
          className="checkbox-field__input"
          {...props}
        />
        <span
          className={`checkbox-field__icon ${
            props.checked && !indeterminate ? "checked" : ""
          }`}
        >
          <CheckIcon />
        </span>
      </div>
      <label htmlFor={id} className="checkbox-field__label">
        {label}
      </label>
    </div>
  );
}
