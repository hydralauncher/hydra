import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import cn from "classnames";

import { Badge } from "@renderer/components/badge/badge";

import "./source-badges.scss";

const BADGE_GAP = 8;

export interface SourceBadgesProps {
  sources: string[];
  className?: string;
}

export function SourceBadges({
  sources,
  className,
}: Readonly<SourceBadgesProps>) {
  const { t } = useTranslation("game_card");
  const formatOverflow = useCallback(
    (hiddenCount: number) =>
      `+${hiddenCount} ${t("available", { count: hiddenCount })}`,
    [t]
  );
  const rowRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(sources.length);

  useLayoutEffect(() => {
    const row = rowRef.current;
    const measure = measureRef.current;
    if (!row || !measure) return;

    const compute = () => {
      const available = row.clientWidth;
      if (available === 0) return;

      const children = Array.from(measure.children) as HTMLElement[];
      const overflowWidth = children.at(-1)?.offsetWidth ?? 0;
      const widths = children
        .slice(0, sources.length)
        .map((child) => child.offsetWidth);

      const fit = (reserveOverflow: boolean) => {
        let total = reserveOverflow ? overflowWidth + BADGE_GAP : 0;
        let count = 0;
        for (let i = 0; i < widths.length; i++) {
          total += widths[i] + (i > 0 ? BADGE_GAP : 0);
          if (total > available) break;
          count++;
        }
        return count;
      };

      const all = fit(false);
      setVisibleCount(
        all >= sources.length ? sources.length : Math.max(1, fit(true))
      );
    };

    const observer = new ResizeObserver(compute);
    observer.observe(row);
    compute();
    return () => observer.disconnect();
  }, [sources, formatOverflow]);

  if (sources.length === 0) return null;

  const visible = sources.slice(0, visibleCount);
  const hidden = sources.length - visible.length;

  return (
    <>
      <div
        ref={measureRef}
        className="source-badges__measure"
        aria-hidden="true"
      >
        {sources.map((sourceName) => (
          <Badge key={sourceName}>{sourceName}</Badge>
        ))}
        <Badge>{formatOverflow(sources.length)}</Badge>
      </div>
      <div ref={rowRef} className={cn("source-badges", className)}>
        {visible.map((sourceName) => (
          <Badge key={sourceName}>{sourceName}</Badge>
        ))}
        {hidden > 0 && <Badge>{formatOverflow(hidden)}</Badge>}
      </div>
    </>
  );
}
