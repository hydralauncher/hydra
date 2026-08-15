import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";

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

const STATUS_COLORS: Record<MacCompatibilityStatusValue, string> = {
  unknown: "#9ca3af",
  checking: "#60a5fa",
  ready: "#4ade80",
  needs_setup: "#ffc107",
  needs_repair: "#ffc107",
  unsupported: "#e11d48",
  error: "#e11d48",
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

  const issues = compatibility?.issues ?? [];

  return (
    <div
      style={{
        minHeight: "100%",
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0a0a0a",
        color: "#ffffff",
        padding: "32px",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "720px",
          borderRadius: "20px",
          background: "#111111",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
          padding: "32px",
          boxSizing: "border-box",
        }}
      >
        {/* Hydra logo */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            marginBottom: "28px",
          }}
        >
          <div
            aria-label="Hydra logo placeholder"
            style={{
              width: "76px",
              height: "76px",
              borderRadius: "50%",
              border: "2px solid rgba(255,255,255,0.9)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "28px",
              fontWeight: 700,
              letterSpacing: "-2px",
            }}
          >
            H
          </div>
        </div>

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: "28px" }}>
          <div
            style={{
              fontSize: "13px",
              fontWeight: 600,
              letterSpacing: "2px",
              textTransform: "uppercase",
              opacity: 0.55,
              marginBottom: "8px",
            }}
          >
            Mac Compatibility
          </div>

          <h1
            style={{
              margin: 0,
              fontSize: "30px",
              fontWeight: 700,
              letterSpacing: "-0.8px",
            }}
          >
            {compatibility?.title ?? title}
          </h1>

          {systemLine ? (
            <div
              style={{
                marginTop: "10px",
                fontSize: "12px",
                opacity: 0.5,
              }}
            >
              {systemLine}
            </div>
          ) : null}
        </div>

        {/* Game / compatibility status */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            padding: "18px",
            borderRadius: "14px",
            background: "#181818",
            border: "1px solid rgba(255,255,255,0.06)",
            marginBottom: "20px",
          }}
        >
          {gameIcon ? (
            <div
              style={{
                width: "52px",
                height: "52px",
                flexShrink: 0,
                borderRadius: "10px",
                overflow: "hidden",
              }}
            >
              {gameIcon}
            </div>
          ) : (
            <div
              style={{
                width: "52px",
                height: "52px",
                flexShrink: 0,
                borderRadius: "10px",
                background: "#242424",
              }}
            />
          )}

          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: "12px",
                textTransform: "uppercase",
                letterSpacing: "1px",
                opacity: 0.5,
                marginBottom: "4px",
              }}
            >
              Compatibility Status
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                fontSize: "16px",
                fontWeight: 600,
              }}
            >
              <span
                style={{
                  width: "9px",
                  height: "9px",
                  flexShrink: 0,
                  borderRadius: "50%",
                  background: STATUS_COLORS[status],
                  boxShadow: `0 0 10px ${STATUS_COLORS[status]}99`,
                }}
              />

              {statusLabel}
            </div>
          </div>
        </div>

        {/* Wine information */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "12px",
            marginBottom: "24px",
          }}
        >
          <InfoCard label="Wine Version" value={wineValue} />

          <InfoCard label="Environment" value={environmentValue} />
        </div>

        {/* Actions */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          <ActionButton
            primary
            disabled={actionsDisabled || runningAction !== null}
            onClick={() => void runAction("test")}
          >
            {runningAction === "test" ? "Testing…" : "Test Setup"}
          </ActionButton>

          <ActionButton
            disabled={actionsDisabled || runningAction !== null}
            onClick={() => void runAction("fix")}
          >
            {runningAction === "fix" ? "Fixing…" : "Fix Everything"}
          </ActionButton>

          <ActionButton
            disabled={actionsDisabled || runningAction !== null}
            onClick={() => void runAction("repair")}
          >
            {runningAction === "repair" ? "Repairing…" : "Repair"}
          </ActionButton>
        </div>

        {/* Diagnostics */}
        <div
          style={{
            marginTop: "24px",
            paddingTop: "20px",
            borderTop: "1px solid rgba(255,255,255,0.07)",
            fontSize: "12px",
            lineHeight: 1.6,
          }}
        >
          {message ? (
            <div
              style={{
                marginBottom: issues.length > 0 ? "12px" : 0,
                padding: "12px 14px",
                borderRadius: "10px",
                background: "#151515",
                border: "1px solid rgba(255,255,255,0.06)",
                opacity: 0.85,
                overflowWrap: "anywhere",
              }}
            >
              {message}
            </div>
          ) : null}

          {issues.length > 0 ? (
            <ul
              style={{
                margin: 0,
                padding: 0,
                listStyle: "none",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
              }}
            >
              {issues.map((issue) => (
                <li
                  key={issue.id}
                  style={{
                    padding: "12px 14px",
                    borderRadius: "10px",
                    background: "#151515",
                    border: "1px solid rgba(255,255,255,0.06)",
                    overflowWrap: "anywhere",
                  }}
                >
                  <div
                    style={{
                      fontWeight: 600,
                      marginBottom: "4px",
                      color:
                        issue.severity === "error"
                          ? "#f87171"
                          : issue.severity === "warning"
                            ? "#ffc107"
                            : "#ffffff",
                    }}
                  >
                    {issue.title}
                  </div>

                  <div style={{ opacity: 0.6 }}>{issue.description}</div>
                </li>
              ))}
            </ul>
          ) : null}

          {!message && issues.length === 0 ? (
            <div style={{ opacity: 0.45, textAlign: "center" }}>
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
    <div
      style={{
        padding: "16px",
        borderRadius: "12px",
        background: "#151515",
        border: "1px solid rgba(255,255,255,0.05)",
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontSize: "11px",
          textTransform: "uppercase",
          letterSpacing: "0.8px",
          opacity: 0.45,
          marginBottom: "6px",
        }}
      >
        {label}
      </div>

      <div
        style={{
          fontSize: "14px",
          fontWeight: 600,
          overflowWrap: "anywhere",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function ActionButton({
  children,
  primary = false,
  disabled = false,
  onClick,
}: {
  children: ReactNode;
  primary?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        width: "100%",
        border: primary
          ? "1px solid rgba(255,255,255,0.25)"
          : "1px solid rgba(255,255,255,0.08)",
        borderRadius: "12px",
        padding: "14px 18px",
        background: primary ? "#ffffff" : "#181818",
        color: primary ? "#000000" : "#ffffff",
        fontSize: "14px",
        fontWeight: 650,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
        transition: "transform 120ms ease, opacity 120ms ease",
      }}
    >
      {children}
    </button>
  );
}
