import { useCallback, useEffect, useRef, useState } from "react";

import { MacCompatibilityCircle } from "./MacCompatibilityCircle";
import { toCircleStatus } from "./mac-compatibility-status";

import "./MacCompatibilityBadge.scss";

interface MacCompatibilityBadgeProps {
  shop: string;
  objectId: string;
  title: string;
  isFavorite?: boolean;
  isWindowsGame?: boolean;
  /**
   * When provided, activating the circle calls this instead of opening
   * the small popover — used on the game's own page, where clicking
   * should open the full compatibility panel with repair actions.
   */
  onOpenFullPanel?: () => void;
  /**
   * Checks compatibility as soon as the badge mounts, same as
   * isFavorite does, but without implying the game is actually
   * favorited. Used on the game's own page, where the badge should
   * always show real status right away.
   */
  autoCheck?: boolean;
}

const STATUS_LABELS: Record<MacCompatibilityStatusValue, string> = {
  unknown: "Not checked yet",
  checking: "Checking…",
  ready: "Ready to play",
  needs_setup: "Needs setup",
  needs_repair: "Needs repair",
  unsupported: "Not supported",
  error: "Could not check",
};

export function MacCompatibilityBadge({
  shop,
  objectId,
  title,
  isFavorite = false,
  isWindowsGame = true,
  onOpenFullPanel,
  autoCheck = false,
}: MacCompatibilityBadgeProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const autoCheckAttemptedRef = useRef(false);
  const [status, setStatus] = useState<MacCompatibilityStatusValue>("unknown");
  const [compatibility, setCompatibility] =
    useState<MacGameCompatibilityView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  const runCheck = useCallback(
    async (revealResults: boolean) => {
      const bridge = window.macCompatibility;
      if (
        window.electron.platform !== "darwin" ||
        !bridge ||
        !shop ||
        !objectId ||
        busy
      ) {
        return;
      }

      if (revealResults) setIsOpen(true);
      setBusy(true);
      setStatus("checking");
      setMessage(null);

      try {
        const result = await bridge.checkGame(
          shop,
          objectId,
          title,
          isWindowsGame
        );

        if (result) {
          setCompatibility(result);
          setStatus(result.status);
        } else {
          setCompatibility(null);
          setStatus("unknown");
          setMessage("No compatibility result was returned.");
        }
      } catch (error) {
        setCompatibility(null);
        setStatus("error");
        setMessage(
          error instanceof Error
            ? error.message
            : "Could not read the compatibility status."
        );
      } finally {
        setBusy(false);
      }
    },
    [busy, isWindowsGame, objectId, shop, title]
  );

  useEffect(() => {
    if (
      window.electron.platform !== "darwin" ||
      (!isFavorite && !autoCheck) ||
      autoCheckAttemptedRef.current
    ) {
      return;
    }

    autoCheckAttemptedRef.current = true;
    void runCheck(false);
  }, [isFavorite, autoCheck, runCheck]);

  useEffect(() => {
    if (!isOpen) return;

    const handleDocumentPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handleDocumentPointerDown);
    return () =>
      document.removeEventListener("pointerdown", handleDocumentPointerDown);
  }, [isOpen]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const stopCardInteraction = (event: Event) => event.stopPropagation();
    root.addEventListener("click", stopCardInteraction);
    root.addEventListener("contextmenu", stopCardInteraction);

    return () => {
      root.removeEventListener("click", stopCardInteraction);
      root.removeEventListener("contextmenu", stopCardInteraction);
    };
  }, []);

  if (window.electron.platform !== "darwin" || !window.macCompatibility) {
    return null;
  }

  const issues = compatibility?.issues ?? [];
  const statusLabel = STATUS_LABELS[status];

  return (
    <div ref={rootRef} className="mac-compatibility-badge">
      <MacCompatibilityCircle
        size={28}
        status={toCircleStatus(status)}
        busy={busy}
        stopPropagation
        onActivate={
          onOpenFullPanel ? onOpenFullPanel : () => void runCheck(true)
        }
      />

      {isOpen && (
        <div
          className="mac-compatibility-badge__popover"
          role="status"
          aria-live="polite"
        >
          <div className="mac-compatibility-badge__heading">
            <span className="mac-compatibility-badge__label">
              Mac compatibility
            </span>
            <strong>{busy ? "Checking…" : statusLabel}</strong>
          </div>

          {message && (
            <p className="mac-compatibility-badge__message">{message}</p>
          )}

          {!busy && issues.length > 0 && (
            <ul className="mac-compatibility-badge__issues">
              {issues.map((issue) => (
                <li
                  key={issue.id}
                  className="mac-compatibility-badge__issue"
                  data-severity={issue.severity}
                >
                  <strong>{issue.title}</strong>
                  <span>{issue.description}</span>
                </li>
              ))}
            </ul>
          )}

          {!busy && !message && issues.length === 0 && (
            <p className="mac-compatibility-badge__message">
              {status === "ready"
                ? "No problems found."
                : status === "needs_setup"
                  ? "Open the compatibility panel to set up this game."
                  : status === "needs_repair"
                    ? "Open the compatibility panel to repair this game."
                    : status === "unsupported"
                      ? "This game is not currently supported on this Mac."
                      : "Click the circle to run a fresh check."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
