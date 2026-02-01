import { useId } from "react";
import { TickCircle } from "iconsax-reactjs";
import "./checkbox-field.scss";

export interface CheckboxFieldProps
  extends React.DetailedHTMLProps<
    React.InputHTMLAttributes<HTMLInputElement>,
    HTMLInputElement
  > {
  label: string | React.ReactNode;
}

export function CheckboxField({ label, ...props }: CheckboxFieldProps) {
  const id = useId();

  return (
    <div className="checkbox-field">
      <div
        className={`checkbox-field__checkbox ${props.checked ? "checked" : ""}`}
      >
        <input
          id={id}
          type="checkbox"
          className="checkbox-field__input"
          {...props}
        />
        {props.checked && <TickCircle />}
      </div>
      <label htmlFor={id} className="checkbox-field__label">
        {label}
      </label>
    </div>
  );
}
