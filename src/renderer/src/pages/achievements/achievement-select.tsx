import { type ReactNode, useState } from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { ChevronDownIcon } from "@primer/octicons-react";
import cn from "classnames";
import {
  LIBRARY_DROPDOWN_CHEVRON_SIZE,
  LIBRARY_DROPDOWN_COLLISION_PADDING,
  LIBRARY_DROPDOWN_SIDE_OFFSET,
} from "../library/library-dropdown";
import "./achievement-select.scss";

export interface AchievementSelectOption<TValue extends string> {
  value: TValue;
  label: string;
  icon: ReactNode;
  count?: number;
}

interface AchievementSelectProps<TValue extends string> {
  value: TValue;
  options: AchievementSelectOption<TValue>[];
  onChange: (value: TValue) => void;
  ariaLabel: string;
  fitToOptions?: boolean;
}

export function AchievementSelect<TValue extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  fitToOptions = false,
}: Readonly<AchievementSelectProps<TValue>>) {
  const [open, setOpen] = useState(false);

  const selected = options.find((option) => option.value === value);

  return (
    <DropdownMenuPrimitive.Root
      modal={false}
      open={open}
      onOpenChange={setOpen}
    >
      <DropdownMenuPrimitive.Trigger asChild>
        <button
          type="button"
          className={cn("achievement-select__trigger", {
            "achievement-select__trigger--fit": fitToOptions,
          })}
          aria-label={ariaLabel}
        >
          {selected?.icon}
          {fitToOptions ? (
            <span className="achievement-select__trigger-label achievement-select__trigger-label--stack">
              {options.map((option) => (
                <span
                  key={option.value}
                  aria-hidden={option.value !== value}
                  className={cn("achievement-select__trigger-option", {
                    "achievement-select__trigger-option--selected":
                      option.value === value,
                  })}
                >
                  {option.label}
                </span>
              ))}
            </span>
          ) : (
            <span className="achievement-select__trigger-label">
              {selected?.label ?? ""}
            </span>
          )}
          <ChevronDownIcon
            size={LIBRARY_DROPDOWN_CHEVRON_SIZE}
            className="achievement-select__chevron"
          />
        </button>
      </DropdownMenuPrimitive.Trigger>

      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          align="end"
          sideOffset={LIBRARY_DROPDOWN_SIDE_OFFSET}
          collisionPadding={LIBRARY_DROPDOWN_COLLISION_PADDING}
          className={cn("achievement-select__content", {
            "achievement-select__content--fit": fitToOptions,
          })}
        >
          <DropdownMenuPrimitive.RadioGroup
            value={value}
            onValueChange={(nextValue) => onChange(nextValue as TValue)}
          >
            {options.map((option) => (
              <DropdownMenuPrimitive.RadioItem
                key={option.value}
                value={option.value}
                className="achievement-select__item"
              >
                {option.icon}
                <span className="achievement-select__item-label">
                  {option.label}
                </span>
                {option.count !== undefined && (
                  <span className="achievement-select__item-count">
                    {option.count}
                  </span>
                )}
              </DropdownMenuPrimitive.RadioItem>
            ))}
          </DropdownMenuPrimitive.RadioGroup>
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
