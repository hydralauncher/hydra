import { useRef } from "react";
import { ArrowLeftIcon, ArrowRightIcon } from "@primer/octicons-react";
import {
  NavigationType,
  useNavigate,
  useNavigationType,
} from "react-router-dom";
import { useTranslation } from "react-i18next";
import cn from "classnames";

import "./navigation-arrows.scss";

/**
 * Where the current entry sits in react-router's history stack. Entries
 * written outside the router (the game page swaps its own in with
 * `replaceState`) carry no index.
 */
const getHistoryIndex = () => {
  const idx = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof idx === "number" ? idx : null;
};

export interface NavigationArrowsProps {
  className?: string;
}

/** Back and forward buttons for the main window's page history. */
export function NavigationArrows({
  className,
}: Readonly<NavigationArrowsProps>) {
  const navigate = useNavigate();
  const { t } = useTranslation("header");

  // Also re-renders the buttons on every navigation.
  const navigationType = useNavigationType();

  const historyIndex = getHistoryIndex();

  // The furthest entry still ahead. `history.length` cannot tell, since it
  // also counts entries from before the router started.
  const furthestIndexRef = useRef(historyIndex ?? 0);

  if (historyIndex !== null) {
    // Opening a page drops whatever was ahead; going back keeps it.
    furthestIndexRef.current =
      navigationType === NavigationType.Push
        ? historyIndex
        : Math.max(furthestIndexRef.current, historyIndex);
  }

  // Without an index, assume there is somewhere to go back to but nothing
  // ahead, rather than offering a forward step that does nothing.
  const canGoBack =
    historyIndex === null ? window.history.length > 1 : historyIndex > 0;
  const canGoForward =
    historyIndex !== null && historyIndex < furthestIndexRef.current;

  return (
    <div className={cn("navigation-arrows", className)}>
      <button
        type="button"
        className="navigation-arrows__button"
        onClick={() => navigate(-1)}
        disabled={!canGoBack}
        aria-label={t("back")}
        title={t("back")}
      >
        <ArrowLeftIcon size={14} />
      </button>

      <button
        type="button"
        className="navigation-arrows__button"
        onClick={() => navigate(1)}
        disabled={!canGoForward}
        aria-label={t("forward")}
        title={t("forward")}
      >
        <ArrowRightIcon size={14} />
      </button>
    </div>
  );
}
