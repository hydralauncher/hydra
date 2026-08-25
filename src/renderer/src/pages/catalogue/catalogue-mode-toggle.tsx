import { useTranslation } from "react-i18next";
import cn from "classnames";
import { DeviceDesktopIcon } from "@primer/octicons-react";

import { useAppDispatch, useAppSelector } from "@renderer/hooks";
import { setMode } from "@renderer/features";
import { ClassicsIcon } from "@renderer/pages/library/category-filter";

import "./catalogue-mode-toggle.scss";

export function CatalogueModeToggle() {
  const { t } = useTranslation("catalogue");
  const dispatch = useAppDispatch();
  const mode = useAppSelector((state) => state.catalogueSearch.mode);

  return (
    <div className="catalogue-mode-toggle" role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={mode === "modern"}
        className={cn("catalogue-mode-toggle__option", {
          "catalogue-mode-toggle__option--active": mode === "modern",
        })}
        onClick={() => dispatch(setMode("modern"))}
        title="Modernos"
      >
        <DeviceDesktopIcon size={14} />
        {mode === "modern" && <span>Modernos</span>}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "classics"}
        className={cn("catalogue-mode-toggle__option", {
          "catalogue-mode-toggle__option--active": mode === "classics",
        })}
        onClick={() => dispatch(setMode("classics"))}
        title={t("mode_classics", { defaultValue: "Clássicos" })}
      >
        <ClassicsIcon size={16} />
        {mode === "classics" && (
          <span>{t("mode_classics", { defaultValue: "Clássicos" })}</span>
        )}
      </button>
    </div>
  );
}
