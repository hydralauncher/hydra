import { useEffect, useState } from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { ChevronDownIcon } from "@primer/octicons-react";
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
  const [open, setOpen] = useState(false);

  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;

    const scrollElement = document.querySelector(".library__games-scroll");
    if (!scrollElement) return;

    const close = () => setOpen(false);
    scrollElement.addEventListener("wheel", close, { passive: true });
    scrollElement.addEventListener("scroll", close, { passive: true });

    return () => {
      scrollElement.removeEventListener("wheel", close);
      scrollElement.removeEventListener("scroll", close);
    };
  }, [open]);

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
