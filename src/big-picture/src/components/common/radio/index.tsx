import "./styles.scss";

import { type ReactNode, useId, type MouseEvent } from "react";
import cn from "classnames";
import type { FocusOverrides } from "../../../services";
import { FocusItem } from "..";

export interface RadioProps {
  id?: string;
  label?: ReactNode;
  checked?: boolean;
  block?: boolean;
  disabled?: boolean;
  focusId?: string;
  navigationOverrides?: FocusOverrides;
  onChange?: (checked: boolean) => void;
}

export const Radio = ({ label, ...props }: Readonly<RadioProps>) => {
  const generatedId = useId();
  const id = props.id ?? generatedId;

  const isChecked = props.checked ?? false;

  const handleChange = (checked: boolean) => {
    if (isChecked && checked) return;

    props.onChange?.(checked);
  };

  const handleBlockClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!props.block) return;
    if ((e.target as HTMLElement).closest(".radio__input")) return;

    e.preventDefault();
    handleChange(true);
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
      <FocusItem
        id={props.focusId}
        navigationState={props.disabled ? "disabled" : "active"}
        navigationOverrides={props.navigationOverrides}
        asChild
      >
        <button // NOSONAR - custom styled radio, not native input
          id={id}
          disabled={props.disabled}
          className={cn("radio__input", {
            "radio__input--checked": isChecked,
          })}
          onClick={() => handleChange(true)}
          // eslint-disable-next-line jsx-a11y/prefer-tag-over-role -- styled button
          role="radio"
          aria-checked={isChecked}
          aria-labelledby={label ? `${id}-label` : undefined}
        >
          {isChecked ? (
            <span className="radio__input__dot" aria-hidden="true" />
          ) : null}
        </button>
      </FocusItem>

      {label ? (
        <label className="radio__label" id={`${id}-label`} htmlFor={id}>
          {label}
        </label>
      ) : null}
    </div>
  );
};
