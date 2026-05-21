import "./styles.scss";

import { CheckIcon } from "@phosphor-icons/react";
import { type ReactNode, useId, type MouseEvent } from "react";
import cn from "classnames";
import type { FocusOverrides } from "../../../services";
import { FocusItem } from "..";

export interface CheckboxProps {
  id?: string;
  label?: ReactNode;
  secondaryText?: ReactNode;
  checked?: boolean;
  block?: boolean;
  disabled?: boolean;
  focusId?: string;
  navigationOverrides?: FocusOverrides;
  onChange?: (checked: boolean) => void;
}

export const Checkbox = ({
  label,
  secondaryText,
  ...props
}: Readonly<CheckboxProps>) => {
  const generatedId = useId();
  const id = props.id ?? generatedId;

  const isChecked = props.checked ?? false;

  const handleChange = (checked: boolean) => {
    props.onChange?.(checked);
  };

  const handleBlockClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!props.block) return;
    if ((e.target as HTMLElement).closest(".checkbox__input")) return;
    if (
      (e.target as HTMLElement).closest(
        "a, button, input, select, textarea, [role='button']"
      )
    ) {
      return;
    }

    e.preventDefault();
    handleChange(!isChecked);
  };

  const handleLabelClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (props.disabled) return;
    e.preventDefault();
    e.stopPropagation();
    handleChange(!isChecked);
  };

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      onClick={handleBlockClick}
      className={cn("checkbox", {
        "checkbox--block": props.block,
        "checkbox--disabled": props.disabled,
      })}
    >
      <FocusItem
        id={props.focusId}
        navigationState={props.disabled ? "disabled" : "active"}
        navigationOverrides={props.navigationOverrides}
        asChild
      >
        <button // NOSONAR - custom styled checkbox, not native input
          id={id}
          disabled={props.disabled}
          className={cn("checkbox__input", {
            "checkbox__input--checked": isChecked,
          })}
          onClick={() => handleChange(!isChecked)}
          // eslint-disable-next-line jsx-a11y/prefer-tag-over-role -- styled button
          role="checkbox"
          aria-checked={isChecked}
          aria-labelledby={label ? `${id}-label` : undefined}
        >
          {isChecked && (
            <CheckIcon className="checkbox__input__icon" size={14} />
          )}
        </button>
      </FocusItem>

      {label || secondaryText ? (
        <div className="checkbox__copy">
          {label ? (
            <button
              type="button"
              className="checkbox__label"
              id={`${id}-label`}
              disabled={props.disabled}
              onClick={handleLabelClick}
            >
              <span className="checkbox__label-primary">{label}</span>
            </button>
          ) : null}

          {secondaryText ? (
            <div className="checkbox__label-secondary">{secondaryText}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
