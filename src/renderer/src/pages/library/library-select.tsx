import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { ChevronDownIcon } from "@primer/octicons-react";
import { useCloseOnLibraryScroll } from "./use-close-on-library-scroll";
import "./library-select.scss";

interface LibrarySelectOption {
  value: string;
  label: string;
}

interface LibrarySelectProps {
  value: string;
  options: LibrarySelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
}

export function LibrarySelect({
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel,
}: Readonly<LibrarySelectProps>) {
  const [open, setOpen] = useCloseOnLibraryScroll();

  const selected = options.find((option) => option.value === value);

  return (
    <DropdownMenuPrimitive.Root
      modal={false}
      open={open}
      onOpenChange={setOpen}
    >
      <DropdownMenuPrimitive.Trigger asChild disabled={disabled}>
        <button
          type="button"
          className="library-select__trigger"
          aria-label={ariaLabel}
          disabled={disabled}
        >
          <span className="library-select__trigger-label">
            {selected?.label ?? ""}
          </span>
          <ChevronDownIcon size={12} className="library-select__chevron" />
        </button>
      </DropdownMenuPrimitive.Trigger>

      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          align="start"
          sideOffset={6}
          collisionPadding={16}
          className="library-select__content"
        >
          <DropdownMenuPrimitive.RadioGroup
            value={value}
            onValueChange={onChange}
          >
            {options.map((option) => (
              <DropdownMenuPrimitive.RadioItem
                key={option.value}
                value={option.value}
                className="library-select__item"
              >
                <span className="library-select__item-label">
                  {option.label}
                </span>
              </DropdownMenuPrimitive.RadioItem>
            ))}
          </DropdownMenuPrimitive.RadioGroup>
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
