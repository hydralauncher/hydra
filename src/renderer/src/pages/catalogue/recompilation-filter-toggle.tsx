import { useTranslation } from "react-i18next";
import cn from "classnames";

import "./recompilation-filter-toggle.scss";

export const RECOMPILATION_FILTER_COLOR = "#3e62c0";

export interface RecompilationFilterToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function RecompilationFilterToggle({
  checked,
  onChange,
}: Readonly<RecompilationFilterToggleProps>) {
  const { t } = useTranslation("catalogue");

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={cn("recompilation-filter-toggle", {
        "recompilation-filter-toggle--checked": checked,
      })}
      onClick={() => onChange(!checked)}
    >
      <span
        className="recompilation-filter-toggle__orb"
        style={{ backgroundColor: RECOMPILATION_FILTER_COLOR }}
        aria-hidden="true"
      />
      <span className="recompilation-filter-toggle__title">
        {t("recompilations_filter")}
      </span>
      <span className="recompilation-filter-toggle__switch" aria-hidden="true">
        <span className="recompilation-filter-toggle__knob" />
      </span>
    </button>
  );
}
