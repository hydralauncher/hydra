import { CheckIcon, XIcon } from "@phosphor-icons/react";
import { FocusItem } from "../../components";
import { useNavigationIsFocused } from "../../stores";

interface CatalogueFilterCheckboxProps {
  id: string;
  focusId: string;
  label: string;
  color: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  variant?: "checkbox" | "remove";
}

export function CatalogueFilterCheckbox({
  id,
  focusId,
  label,
  color,
  checked,
  onChange,
  variant = "checkbox",
}: Readonly<CatalogueFilterCheckboxProps>) {
  const labelId = `${id}-label`;
  const isFocused = useNavigationIsFocused(focusId);
  const isRemoveVariant = variant === "remove";

  return (
    <FocusItem id={focusId} asChild>
      <button
        type="button"
        className="catalogue-filter-checkbox"
        data-variant={variant}
        data-modal-filter-focused={isFocused || undefined}
        role={isRemoveVariant ? undefined : "checkbox"}
        aria-checked={isRemoveVariant ? undefined : checked}
        aria-labelledby={labelId}
        onClick={() => onChange(isRemoveVariant ? false : !checked)}
      >
        <span
          className="catalogue-filter-checkbox__dot"
          style={{ backgroundColor: color }}
        />

        <span id={labelId} className="catalogue-filter-checkbox__label">
          {label}
        </span>

        {isRemoveVariant ? (
          <span
            className="catalogue-filter-checkbox__remove-button"
            aria-hidden
          >
            <XIcon size={12} weight="bold" />
          </span>
        ) : (
          <span className="catalogue-filter-checkbox__box" aria-hidden>
            {checked ? <CheckIcon size={22} weight="bold" /> : null}
          </span>
        )}
      </button>
    </FocusItem>
  );
}
