import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import cn from "classnames";

interface SelectorTooltip {
  label: string;
  left: number;
  top: number;
  isNearEdge: boolean;
}

const TOOLTIP_GAP = 8;
// Closer than this to the window's edge, the tooltip aligns to the option's end.
const TOOLTIP_EDGE_DISTANCE = 72;

// The name of a selector option that only shows its icon.
export function useSelectorTooltip() {
  const [tooltip, setTooltip] = useState<SelectorTooltip | null>(null);
  const hideTooltip = useCallback(() => setTooltip(null), []);

  // The tooltip is fixed to the window, so scrolling would leave it behind.
  const isTooltipVisible = tooltip !== null;
  useEffect(() => {
    if (!isTooltipVisible) return;
    const options = { capture: true, passive: true };
    globalThis.addEventListener("scroll", hideTooltip, options);

    return () => globalThis.removeEventListener("scroll", hideTooltip, options);
  }, [hideTooltip, isTooltipVisible]);

  const showTooltip = (option: HTMLElement, label: string) => {
    const { left, right, top, width } = option.getBoundingClientRect();
    const isNearEdge = globalThis.innerWidth - right < TOOLTIP_EDGE_DISTANCE;

    setTooltip({
      label,
      isNearEdge,
      left: isNearEdge ? right : left + width / 2,
      top: top - TOOLTIP_GAP,
    });
  };

  const tooltipElement =
    tooltip &&
    createPortal(
      <span
        className={cn("leaderboard-controls__tooltip", {
          "leaderboard-controls__tooltip--near-edge": tooltip.isNearEdge,
        })}
        style={{ left: tooltip.left, top: tooltip.top }}
        aria-hidden="true"
      >
        {tooltip.label}
      </span>,
      document.body
    );

  return { showTooltip, hideTooltip, tooltipElement };
}
