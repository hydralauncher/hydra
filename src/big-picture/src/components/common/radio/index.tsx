import "./styles.scss";

import { useId, type MouseEvent } from "react";
import cn from "classnames";

export interface RadioProps {
  id?: string;
  label?: string;
  checked?: boolean;
  block?: boolean;
  disabled?: boolean;
  onChange?: (checked: boolean) => void;
}

export const Radio = ({ label, ...props }: Readonly<RadioProps>) => {
  const generatedId = useId();
  const id = props.id ?? generatedId;

  const isChecked = props.checked ?? false;

  const handleChange = (checked: boolean) => {
    props.onChange?.(checked);
  };

  const handleBlockClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!props.block) return;

    e.preventDefault();
    handleChange(!isChecked);
  };

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      onClick={handleBlockClick}
      className={cn("radio", {
        "radio--block": props.block,
        "radio--block--active": props.block && isChecked,
        "radio--disabled": props.disabled,
      })}
    >
      <button // NOSONAR - custom styled radio, not native input
        id={id}
        disabled={props.disabled}
        className={cn("radio__input", {
          "radio__input--checked": isChecked,
        })}
        onClick={() => handleChange(!isChecked)}
        // eslint-disable-next-line jsx-a11y/prefer-tag-over-role -- styled button
        role="radio"
        aria-checked={isChecked}
        aria-labelledby={label ? `${id}-label` : undefined}
      >
        {isChecked ? (
          <span className="radio__input__dot" aria-hidden="true" />
        ) : null}
      </button>

      {label ? (
        <label className="radio__label" id={`${id}-label`} htmlFor={id}>
          {label}
        </label>
      ) : null}
    </div>
  );
};
