import { useId } from "react";
import { createPortal } from "react-dom";
import { CheckCircleFillIcon, CheckCircleIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import { Tooltip } from "react-tooltip";
import "./installed-filter.scss";

interface InstalledFilterProps {
  showInstalledOnly: boolean;
  onShowInstalledOnlyChange: (showInstalledOnly: boolean) => void;
}

export function InstalledFilter({
  showInstalledOnly,
  onShowInstalledOnlyChange,
}: Readonly<InstalledFilterProps>) {
  const { t } = useTranslation("library");

  const tooltipId = useId();

  return (
    <>
      <button
        type="button"
        className="library-installed-filter__button"
        onClick={() => onShowInstalledOnlyChange(!showInstalledOnly)}
        aria-label={t("show_installed_only")}
        aria-pressed={showInstalledOnly}
        data-tooltip-id={tooltipId}
        data-tooltip-content={t("show_installed_only")}
        data-tooltip-place="bottom"
      >
        {showInstalledOnly ? (
          <CheckCircleFillIcon size={16} />
        ) : (
          <CheckCircleIcon size={16} />
        )}
      </button>

      {createPortal(
        <Tooltip id={tooltipId} place="bottom" style={{ zIndex: 1 }} />,
        document.body
      )}
    </>
  );
}
