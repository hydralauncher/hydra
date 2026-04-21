import { useGamepad } from "../../../hooks/use-gamepad.hook";
import { useNavigationSnapshot } from "../../../stores/navigation.store";
import { useGamepadStore } from "../../../stores";
import {
  GamepadAxisDirection,
  GamepadAxisType,
  GamepadButtonType,
} from "../../../types";
import { useEffect, useMemo, useState } from "react";

interface LocalInputDebug {
  label: string;
  source: "gamepad-button" | "left-stick";
  startedAt: number;
}

const DEBUG_BUTTONS = [
  ["A", GamepadButtonType.BUTTON_A],
  ["B", GamepadButtonType.BUTTON_B],
  ["X", GamepadButtonType.BUTTON_X],
  ["Y", GamepadButtonType.BUTTON_Y],
  ["Start", GamepadButtonType.START],
  ["Select", GamepadButtonType.BACK],
  ["Dpad Up", GamepadButtonType.DPAD_UP],
  ["Dpad Down", GamepadButtonType.DPAD_DOWN],
  ["Dpad Left", GamepadButtonType.DPAD_LEFT],
  ["Dpad Right", GamepadButtonType.DPAD_RIGHT],
] as const;

function getStickDirection(x: number, y: number) {
  const threshold = 0.5;

  if (Math.abs(x) < threshold && Math.abs(y) < threshold) {
    return "none";
  }

  if (Math.abs(x) > Math.abs(y)) {
    return x > 0 ? GamepadAxisDirection.RIGHT : GamepadAxisDirection.LEFT;
  }

  return y > 0 ? GamepadAxisDirection.DOWN : GamepadAxisDirection.UP;
}

function getFocusedElementDataset(currentFocusId: string | null) {
  if (!currentFocusId || typeof document === "undefined") {
    return null;
  }

  const element = document.getElementById(currentFocusId);

  if (!element) {
    return null;
  }

  return {
    navigationState: element.dataset.navigationState ?? "unknown",
    hasPrimary: element.dataset.hasPrimary === "true",
    hasSecondary: element.dataset.hasSecondary === "true",
    hasPressX: element.dataset.hasPressX === "true",
    hasPressY: element.dataset.hasPressY === "true",
    hasHoldA: element.dataset.hasHoldA === "true",
    hasHoldB: element.dataset.hasHoldB === "true",
    hasHoldX: element.dataset.hasHoldX === "true",
  };
}

function formatMs(value: number) {
  return `${Math.max(0, Math.round(value))}ms`;
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ display: "grid", gap: 6 }}>
      <strong style={{ color: "var(--primary)", fontSize: 12 }}>{title}</strong>
      <div style={{ display: "grid", gap: 4 }}>{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "120px 1fr",
        gap: 8,
        alignItems: "start",
      }}
    >
      <span style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span style={{ color: "var(--text)", wordBreak: "break-word" }}>
        {value}
      </span>
    </div>
  );
}

export function NavigationDiagnostics() {
  const [isOpen, setIsOpen] = useState(true);
  const [now, setNow] = useState(Date.now());
  const {
    isButtonPressed,
    getAxisValue,
    connectedGamepads,
    hasGamepadConnected,
  } = useGamepad();
  const getActiveGamepad = useGamepadStore((state) => state.getActiveGamepad);

  const { currentFocusId, nodes, regions, layers, debugSnapshot } =
    useNavigationSnapshot();

  const [lastInput, setLastInput] = useState<LocalInputDebug | null>(null);
  const [activeInput, setActiveInput] = useState<LocalInputDebug | null>(null);
  const activeGamepad = getActiveGamepad();
  const leftStickX = getAxisValue(GamepadAxisType.LEFT_STICK_X);
  const leftStickY = getAxisValue(GamepadAxisType.LEFT_STICK_Y);
  const leftStickDirection = getStickDirection(leftStickX, leftStickY);

  const pressedButtons = DEBUG_BUTTONS.filter(([, button]) =>
    isButtonPressed(button)
  ).map(([label]) => label);

  const currentNode = nodes.find((node) => node.id === currentFocusId) ?? null;

  const currentRegion = currentNode
    ? (regions.find((region) => region.id === currentNode.regionId) ?? null)
    : null;

  const [focusedDataset, setFocusedDataset] =
    useState<ReturnType<typeof getFocusedElementDataset>>(null);

  const activeInputLabel =
    pressedButtons[0] ??
    (leftStickDirection !== "none" ? `left-stick.${leftStickDirection}` : null);

  const activeInputSource: LocalInputDebug["source"] = pressedButtons[0]
    ? "gamepad-button"
    : "left-stick";

  const regionPath = useMemo(() => {
    if (!currentRegion) {
      return [];
    }

    const path: string[] = [];
    let regionId: string | null = currentRegion.id;

    while (regionId) {
      const region = regions.find((candidate) => candidate.id === regionId);

      if (!region) break;

      path.unshift(region.id);
      regionId = region.parentRegionId;
    }

    return path;
  }, [currentRegion, regions]);

  useEffect(() => {
    if (!activeInput) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 100);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activeInput]);

  useEffect(() => {
    if (!activeInputLabel) {
      setActiveInput(null);
      return;
    }

    setActiveInput((previous) => {
      if (previous?.label === activeInputLabel) {
        return previous;
      }

      const nextInput = {
        label: activeInputLabel,
        source: activeInputSource,
        startedAt: Date.now(),
      };

      setLastInput(nextInput);
      return nextInput;
    });
  }, [activeInputLabel, activeInputSource]);

  useEffect(() => {
    setFocusedDataset(getFocusedElementDataset(currentFocusId));
  }, [currentFocusId, currentNode?.navigationState]);

  const handleLogSnapshot = () => {
    console.group("[navigation-diagnostics]");
    console.log("gamepad", {
      hasGamepadConnected,
      connectedGamepads,
      activeGamepad,
      pressedButtons,
      leftStick: {
        x: leftStickX,
        y: leftStickY,
        direction: leftStickDirection,
      },
    });
    console.log("input", {
      lastInput,
      activeInput,
    });
    console.log("navigation", {
      currentFocusId,
      currentNode,
      currentRegion,
      regionPath,
      layers,
      debugSnapshot,
    });
    console.groupEnd();
  };

  return (
    <div
      style={{
        position: "fixed",
        right: "calc(var(--spacing-unit) * 6)",
        bottom: "calc(var(--spacing-unit) * 6)",
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: "calc(var(--spacing-unit) * 3)",
        fontSize: 12,
      }}
    >
      {isOpen && (
        <div
          style={{
            width: 420,
            maxHeight: "72vh",
            overflow: "auto",
            display: "grid",
            gap: "calc(var(--spacing-unit) * 4)",
            padding: "calc(var(--spacing-unit) * 4)",
            borderRadius: "calc(var(--spacing-unit) * 3)",
            border: "1px solid var(--secondary-border)",
            backgroundColor: "var(--surface)",
            color: "var(--text)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "calc(var(--spacing-unit) * 3)",
              alignItems: "center",
            }}
          >
            <strong style={{ color: "var(--primary)" }}>Diagnostics</strong>

            <button
              type="button"
              onClick={handleLogSnapshot}
              style={{
                color: "var(--text)",
                border: "1px solid var(--secondary-border)",
                borderRadius: "calc(var(--spacing-unit) * 2)",
                padding:
                  "calc(var(--spacing-unit) * 1.5) calc(var(--spacing-unit) * 3)",
                cursor: "pointer",
              }}
            >
              Log snapshot
            </button>
          </div>

          <Section title="Input / Gamepad">
            <Row
              label="activeGamepad"
              value={
                activeGamepad
                  ? `#${activeGamepad.index} ${activeGamepad.name}`
                  : "None"
              }
            />
            <Row label="connected" value={connectedGamepads.length} />
            <Row
              label="pressedButtons"
              value={pressedButtons.join(", ") || "None"}
            />
            <Row
              label="leftStick"
              value={`${leftStickDirection} (${leftStickX.toFixed(
                2
              )}, ${leftStickY.toFixed(2)})`}
            />
            <Row
              label="inputRepeat"
              value={
                activeInput && now - activeInput.startedAt >= 400
                  ? "held"
                  : lastInput
                    ? "single"
                    : "None"
              }
            />
            <Row
              label="holdProgress"
              value={
                activeInput
                  ? `${activeInput.label} ${formatMs(
                      now - activeInput.startedAt
                    )}`
                  : "None"
              }
            />
          </Section>

          <Section title="Focus">
            <Row label="currentFocusId" value={currentFocusId ?? "None"} />
            <Row label="currentRegionId" value={currentRegion?.id ?? "None"} />
            <Row
              label="regionPath"
              value={regionPath.length > 0 ? regionPath.join(" > ") : "None"}
            />
            <Row
              label="orientation"
              value={currentRegion?.orientation ?? "None"}
            />
            <Row
              label="itemState"
              value={
                currentNode?.navigationState ??
                focusedDataset?.navigationState ??
                "None"
              }
            />
            <Row
              label="remembered"
              value={
                currentRegion
                  ? (debugSnapshot.lastFocusedByRegionId[currentRegion.id] ??
                    "None")
                  : "None"
              }
            />
          </Section>

          <Section title="Movement">
            <Row
              label="lastInput"
              value={
                lastInput ? `${lastInput.source}.${lastInput.label}` : "None"
              }
            />
            <Row label="moveResult" value="Not tracked by isolated debug" />
          </Section>

          <Section title="Actions">
            <Row label="lastAction" value="Not tracked by isolated debug" />
            <Row
              label="focusedActions"
              value={
                focusedDataset
                  ? [
                      focusedDataset.hasPrimary && "primary",
                      focusedDataset.hasSecondary && "secondary",
                      focusedDataset.hasPressX && "press.x",
                      focusedDataset.hasPressY && "press.y",
                      focusedDataset.hasHoldA && "hold.a",
                      focusedDataset.hasHoldB && "hold.b",
                      focusedDataset.hasHoldX && "hold.x",
                    ]
                      .filter(Boolean)
                      .join(", ") || "None"
                  : "None"
              }
            />
          </Section>

          <Section title="Layers">
            <Row
              label="activeLayerId"
              value={debugSnapshot.activeLayerId ?? "None"}
            />
            <Row
              label="layerStack"
              value={debugSnapshot.layerIds.join(" > ") || "None"}
            />
          </Section>

          <Section title="Counts">
            <Row label="nodes" value={debugSnapshot.nodeCount} />
            <Row label="regions" value={debugSnapshot.regionCount} />
            <Row label="layers" value={debugSnapshot.layerCount} />
            <Row label="listeners" value={debugSnapshot.listenerCount} />
          </Section>
        </div>
      )}

      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        style={{
          color: "var(--primary)",
          border: "1px solid var(--secondary-border)",
          borderRadius: 999,
          padding:
            "calc(var(--spacing-unit) * 3) calc(var(--spacing-unit) * 4)",
          backgroundColor: "var(--surface)",
          cursor: "pointer",
        }}
      >
        {isOpen ? "Close diagnostics" : "Open diagnostics"}
      </button>
    </div>
  );
}
