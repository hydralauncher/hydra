import { DeviceDesktopIcon } from "@primer/octicons-react";
import { useId } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Tooltip } from "react-tooltip";
import cn from "classnames";

import "./recomp-chip.scss";

interface RecompChipProps {
  /** Port names, most downloaded first. Listed in the hover tooltip. */
  portNames: string[];
  variant: "cover" | "hero";
}

/** Blue glass "Recomp" chip for Classics games with a native PC port. */
export function RecompChip({ portNames, variant }: Readonly<RecompChipProps>) {
  const { t } = useTranslation("catalogue");
  const tooltipId = useId();

  return (
    <>
      <span
        className={cn("recomp-chip", `recomp-chip--${variant}`)}
        data-tooltip-id={tooltipId}
        data-tooltip-content={t("recomp_chip_tooltip", {
          count: portNames.length,
          ports: portNames.join(", "),
        })}
      >
        <DeviceDesktopIcon size={12} aria-hidden="true" />
        {t("recomp_chip")}
      </span>
      {createPortal(
        <Tooltip
          id={tooltipId}
          place="top"
          positionStrategy="fixed"
          style={{ zIndex: 9999, maxWidth: 280 }}
        />,
        document.body
      )}
    </>
  );
}
