import { CheckIcon } from "@phosphor-icons/react";
import { FocusItem } from "../../components";
import { useNavigationIsFocused } from "../../stores";

interface CatalogueFilterCheckboxProps {
  id: string;
  focusId: string;
  label: string;
  color: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function CatalogueFilterCheckbox({
  id,
  focusId,
  label,
  color,
  checked,
  onChange,
}: Readonly<CatalogueFilterCheckboxProps>) {
  const labelId = `${id}-label`;
  const isFocused = useNavigationIsFocused(focusId);

  return (
    <FocusItem id={focusId} asChild>
      <button
        type="button"
        className="catalogue-filter-checkbox"
        data-modal-filter-focused={isFocused || undefined}
        role="checkbox"
        aria-checked={checked}
        aria-labelledby={labelId}
        onClick={() => onChange(!checked)}
      >
        <span
          className="catalogue-filter-checkbox__dot"
          style={{ backgroundColor: color }}
        />

        <span id={labelId} className="catalogue-filter-checkbox__label">
          {label}
        </span>

        <span className="catalogue-filter-checkbox__box" aria-hidden>
          {checked ? <CheckIcon size={22} weight="bold" /> : null}
        </span>
      </button>
    </FocusItem>
  );
}
