import { Fragment, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ClockIcon } from "@primer/octicons-react";
import { Equal, Plus } from "lucide-react";
import { getPlayTimeHoursAndMinutes } from "@shared";
import { SourceIcon } from "@renderer/pages/library/source-icon";
import "./playtime-breakdown-table.scss";

const OPERATOR_ICON_SIZE = 14;

interface PlaytimeBreakdownTableProps {
  hydraPlayTimeInMilliseconds: number;
  nextHydraPlayTimeInMilliseconds: number;
  steamPlayTimeInMilliseconds: number;
}

interface PlaytimeBreakdownColumn {
  key: string;
  icon: ReactNode;
  label: string;
  current: number;
  next: number;
  operator: ReactNode;
}

export function PlaytimeBreakdownTable({
  hydraPlayTimeInMilliseconds,
  nextHydraPlayTimeInMilliseconds,
  steamPlayTimeInMilliseconds,
}: Readonly<PlaytimeBreakdownTableProps>) {
  const { t } = useTranslation(["game_details", "library"]);

  const formatPlaytime = (milliseconds: number) =>
    t("playtime_short", getPlayTimeHoursAndMinutes(milliseconds));

  const columns: PlaytimeBreakdownColumn[] = [
    {
      key: "hydra",
      icon: <SourceIcon source="hydra" />,
      label: t("library_hydra", { ns: "library" }),
      current: hydraPlayTimeInMilliseconds,
      next: nextHydraPlayTimeInMilliseconds,
      operator: null,
    },
    {
      key: "steam",
      icon: <SourceIcon source="steam" />,
      label: t("library_steam", { ns: "library" }),
      current: steamPlayTimeInMilliseconds,
      next: steamPlayTimeInMilliseconds,
      operator: <Plus size={OPERATOR_ICON_SIZE} aria-label="+" />,
    },
    {
      key: "total",
      icon: <ClockIcon size={14} />,
      label: t("playtime_breakdown_total"),
      current: hydraPlayTimeInMilliseconds + steamPlayTimeInMilliseconds,
      next: nextHydraPlayTimeInMilliseconds + steamPlayTimeInMilliseconds,
      operator: <Equal size={OPERATOR_ICON_SIZE} aria-label="=" />,
    },
  ];

  return (
    <div className="playtime-breakdown-table">
      {columns.map((column) => (
        <Fragment key={column.key}>
          {column.operator && <span aria-hidden="true" />}
          <span className="playtime-breakdown-table__label">
            {column.icon}
            {column.label}
          </span>
        </Fragment>
      ))}

      {columns.map((column) => {
        const current = formatPlaytime(column.current);
        const next = formatPlaytime(column.next);

        return (
          <Fragment key={column.key}>
            {column.operator && (
              <span className="playtime-breakdown-table__operator">
                {column.operator}
              </span>
            )}
            <div className="playtime-breakdown-table__value">
              <span className="playtime-breakdown-table__next">{next}</span>
              {next !== current && (
                <s className="playtime-breakdown-table__previous">{current}</s>
              )}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
