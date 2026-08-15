import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";

import { Button } from "@renderer/components/button/button";
import { MacCompatibilityCircle } from "./MacCompatibilityCircle";
import { toCircleStatus } from "./mac-compatibility-status";

import "./MacCompatibilityPanel.scss";

interface MacCompatibilityPanelProps {
  gameName?: string;
  gameIcon?: ReactNode;
  shop?: string;
  objectId?: string;
  isWindowsGame?: boolean;
}

type PanelAction = "test" | "fix" | "repair";

const STATUS_LABELS: Record<MacCompatibilityStatusValue, string> = {
  unknown: "Not checked yet",
  checking: "Checking…",
  ready: "Ready to play",
  needs_setup: "Needs setup",
  needs_repair: "Needs repair",
  unsupported: "Not supported",
  error: "Something went wrong",
};

export function MacCompatibilityPanel({
  gameName,
  gameIcon,
  shop,
  objectId,
  isWindowsGame,
}: MacCompatibilityPanelProps) {
  const [searchParams] = useSearchParams();

  const bridge = useMemo(
    () => (typeof window === "undefined" ? undefined : window.macCompatibility),
    []
  );

  const gameShop = shop ?? searchParams.get("shop") ?? null;
  const gameObjectId = objectId ?? searchParams.get("objectId") ?? null;
  const title = gameName ?? searchParams.get("title") ?? "Game";

  const windowsGame =
    isWindowsGame ?? searchParams.get("isWindowsGame") !== "false";

  const hasGame = Boolean(gameShop && gameObjectId);

  const [systemInfo, setSystemInfo] = useState<MacSystemInfoView | null>(null);
  const [compatibility, setCompatibility] =
    useState<MacGameCompatibilityView | null>(null);
  const [loading, setLoading] = useState(true);
  const [runningAction, setRunningAction] = useState<PanelAction | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!bridge) {
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const info = await bridge.getSystemInfo();
      setSystemInfo(info);

      if (info && gameShop && gameObjectId) {
        const result = await bridge.checkGame(
          gameShop,
          gameObjectId,
          title,
          windowsGame
        );

        setCompatibility(result);
      } else {
        setCompatibility(null);
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not read the compatibility status."
      );
    } finally {
      setLoading(false);
    }
  }, [bridge, gameObjectId, gameShop, title, windowsGame]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runAction = useCallback(
    async (action: PanelAction) => {
      if (!bridge || !gameShop || !gameObjectId || runningAction) return;

      setRunningAction(action);
      setMessage(null);

      try {
        let result: MacCompatibilityActionResultView;

        if (action === "test") {
          result = await bridge.testEnvironment(gameShop, gameObjectId);
        } else if (action === "repair") {
          result = await bridge.repairEnvironment(gameShop, gameObjectId);
        } else {
          result = await bridge.fixEverything(
            gameShop,
            gameObjectId,
            windowsGame
          );
        }

        setMessage(result.message);
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "That did not work. Please try again."
        );
      } finally {
        setRunningAction(null);
        await refresh();
      }
    },
    [bridge, gameObjectId, gameShop, refresh, runningAction, windowsGame]
  );

  const status: MacCompatibilityStatusValue = (() => {
    if (!bridge || (!loading && !systemInfo)) return "unsupported";
    if (loading || runningAction) return "checking";
    if (!hasGame) return "unknown";
    return compatibility?.status ?? "unknown";
  })();

  const statusLabel = (() => {
    if (!bridge || (!loading && !systemInfo)) {
      return "Only available on macOS";
    }
    if (runningAction) return "Working…";
    if (loading) return "Checking…";
    if (!hasGame) return "No game selected";
    return STATUS_LABELS[status];
  })();

  const wineValue = (() => {
    if (compatibility?.environment?.wineVersionName) {
      return compatibility.environment.wineVersionName;
    }
    if (compatibility?.recommendedWineVersionName) {
      return `${compatibility.recommendedWineVersionName} (suggested)`;
    }
    if (systemInfo && !systemInfo.wineAvailable) return "Not installed";
    return "Not selected";
  })();

  const environmentValue = (() => {
    const environment = compatibility?.environment;

    if (!environment) return "Not created";
    if (!environment.exists) return "Missing on disk";
    if (!environment.initialized) return "Not finished";
    return environment.healthy ? "Tested and working" : "Needs repair";
  })();

  const systemLine = systemInfo
    ? [
        systemInfo.osVersion ? `macOS ${systemInfo.osVersion}` : null,
        systemInfo.isAppleSilicon ? "Apple Silicon" : "Intel",
        systemInfo.isAppleSilicon
          ? systemInfo.rosettaAvailable
            ? "Rosetta ready"
            : "Rosetta missing"
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  const actionsDisabled = !bridge || !systemInfo || !hasGame || loading;
  const busy = loading || runningAction !== null;

  const issues = compatibility?.issues ?? [];

  return (
    <div className="mac-compatibility-panel">
      <div className="mac-compatibility-panel__card">
        <div className="mac-compatibility-panel__circle">
          <MacCompatibilityCircle
            status={toCircleStatus(status)}
            busy={busy}
            onActivate={() => void runAction("test")}
          />
        </div>

        <div className="mac-compatibility-panel__header">
          <div className="mac-compatibility-panel__eyebrow">
            Mac Compatibility
          </div>

          <h1 className="mac-compatibility-panel__title">
            {compatibility?.title ?? title}
          </h1>

          {systemLine ? (
            <div className="mac-compatibility-panel__system-line">
              {systemLine}
            </div>
          ) : null}
        </div>

        <div className="mac-compatibility-panel__status-row">
          {gameIcon ? (
            <div className="mac-compatibility-panel__game-icon">
              {gameIcon}
            </div>
          ) : (
            <div className="mac-compatibility-panel__game-icon mac-compatibility-panel__game-icon--empty" />
          )}

          <div className="mac-compatibility-panel__status-text">
            <div className="mac-compatibility-panel__status-label">
              Compatibility Status
            </div>

            <div
              className="mac-compatibility-panel__status-value"
              data-status={status}
            >
              <span className="mac-compatibility-panel__status-dot" />
              {statusLabel}
            </div>
          </div>
        </div>

        <div className="mac-compatibility-panel__info-grid">
          <InfoCard label="Wine Version" value={wineValue} />
          <InfoCard label="Environment" value={environmentValue} />
        </div>

        <div className="mac-compatibility-panel__actions">
          <Button
            theme="primary"
            disabled={actionsDisabled || runningAction !== null}
            onClick={() => void runAction("test")}
          >
            {runningAction === "test" ? "Testing…" : "Test Setup"}
          </Button>

          <Button
            theme="outline"
            disabled={actionsDisabled || runningAction !== null}
            onClick={() => void runAction("fix")}
          >
            {runningAction === "fix" ? "Fixing…" : "Fix Everything"}
          </Button>

          <Button
            theme="outline"
            disabled={actionsDisabled || runningAction !== null}
            onClick={() => void runAction("repair")}
          >
            {runningAction === "repair" ? "Repairing…" : "Repair"}
          </Button>
        </div>

        <div className="mac-compatibility-panel__diagnostics">
          {message ? (
            <div className="mac-compatibility-panel__message">{message}</div>
          ) : null}

          {issues.length > 0 ? (
            <ul className="mac-compatibility-panel__issues">
              {issues.map((issue) => (
                <li
                  key={issue.id}
                  className="mac-compatibility-panel__issue"
                  data-severity={issue.severity}
                >
                  <div className="mac-compatibility-panel__issue-title">
                    {issue.title}
                  </div>
                  <div className="mac-compatibility-panel__issue-description">
                    {issue.description}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}

          {!message && issues.length === 0 ? (
            <div className="mac-compatibility-panel__empty-state">
              {!bridge || (!loading && !systemInfo)
                ? "This panel only works on macOS."
                : hasGame
                  ? "No problems found."
                  : "Open this panel from a game to check its compatibility."}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="mac-compatibility-panel__info-card">
      <div className="mac-compatibility-panel__info-label">{label}</div>
      <div className="mac-compatibility-panel__info-value">{value}</div>
    </div>
  );
}
