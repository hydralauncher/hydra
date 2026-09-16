import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { CheckIcon, ChevronDownIcon } from "@primer/octicons-react";
import { useCloseOnLibraryScroll } from "./use-close-on-library-scroll";
import {
  LIBRARY_DROPDOWN_CHEVRON_SIZE,
  LIBRARY_DROPDOWN_COLLISION_PADDING,
  LIBRARY_DROPDOWN_SIDE_OFFSET,
} from "./library-dropdown";
import "./library-multi-select.scss";

const ITEM_INDICATOR_ICON_SIZE = 14;

interface LibraryMultiSelectOption {
  value: string;
  label: string;
}

interface LibraryMultiSelectProps {
  value: string[];
  options: LibraryMultiSelectOption[];
  allLabel: string;
  triggerLabel: string;
  onChange: (value: string[]) => void;
  disabled?: boolean;
  ariaLabel?: string;
}

export function LibraryMultiSelect({
  value,
  options,
  allLabel,
  triggerLabel,
  onChange,
  disabled = false,
  ariaLabel,
}: Readonly<LibraryMultiSelectProps>) {
  const [open, setOpen] = useCloseOnLibraryScroll();

  const handleToggle = (option: string, checked: boolean) => {
    if (checked) {
      if (value.includes(option)) return;
      onChange([...value, option]);
      return;
    }

    if (value.length <= 1) {
      onChange([]);
      return;
    }

    onChange(value.filter((selected) => selected !== option));
  };

  return (
    <DropdownMenuPrimitive.Root
      modal={false}
      open={open}
      onOpenChange={setOpen}
    >
      <DropdownMenuPrimitive.Trigger asChild disabled={disabled}>
        <button
          type="button"
          className="library-multi-select__trigger"
          aria-label={ariaLabel}
          disabled={disabled}
        >
          <span className="library-multi-select__trigger-label">
            {triggerLabel}
          </span>
          <ChevronDownIcon
            size={LIBRARY_DROPDOWN_CHEVRON_SIZE}
            className="library-multi-select__chevron"
          />
        </button>
      </DropdownMenuPrimitive.Trigger>

      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          align="start"
          sideOffset={LIBRARY_DROPDOWN_SIDE_OFFSET}
          collisionPadding={LIBRARY_DROPDOWN_COLLISION_PADDING}
          className="library-multi-select__content"
        >
          <DropdownMenuPrimitive.CheckboxItem
            checked={value.length === 0}
            onCheckedChange={(checked) => {
              if (checked === true) onChange([]);
            }}
            onSelect={(event) => event.preventDefault()}
            className="library-multi-select__item"
          >
            <span className="library-multi-select__item-label">{allLabel}</span>
            <DropdownMenuPrimitive.ItemIndicator
              forceMount
              className="library-multi-select__item-indicator"
            >
              <CheckIcon size={ITEM_INDICATOR_ICON_SIZE} />
            </DropdownMenuPrimitive.ItemIndicator>
          </DropdownMenuPrimitive.CheckboxItem>

          {options.map((option) => (
            <DropdownMenuPrimitive.CheckboxItem
              key={option.value}
              checked={value.includes(option.value)}
              onCheckedChange={(checked) =>
                handleToggle(option.value, checked === true)
              }
              onSelect={(event) => event.preventDefault()}
              className="library-multi-select__item"
            >
              <span className="library-multi-select__item-label">
                {option.label}
              </span>
              <DropdownMenuPrimitive.ItemIndicator
                forceMount
                className="library-multi-select__item-indicator"
              >
                <CheckIcon size={ITEM_INDICATOR_ICON_SIZE} />
              </DropdownMenuPrimitive.ItemIndicator>
            </DropdownMenuPrimitive.CheckboxItem>
          ))}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
