import { useGamepad } from "../../../hooks/use-gamepad.hook";
import { useNavigationSnapshot } from "../../../stores/navigation.store";
import { useGamepadStore } from "../../../stores";
import {
  GamepadAxisDirection,
  GamepadAxisType,
  GamepadButtonType,
  GamepadInputStatus,
} from "../../../types";
import { type ReactNode, useEffect, useMemo, useState } from "react";

interface LocalInputDebug {
  label: string;
  source: "gamepad-button" | "left-stick";
  startedAt: number;
}

interface GamepadEventDebug {
  gamepadIndex: number;
  label: string;
  source: "gamepad-button" | "left-stick";
  status: GamepadInputStatus;
  accepted: boolean;
  activeGamepadIndex: number | null;
  echoOfGamepadIndex?: number | null;
  echoSuppressionMs?: number | null;
  startedAt: number;
}

interface RawButtonDebug {
  index: number;
  pressed: boolean;
  value: number;
}

interface RawAxisDebug {
  index: number;
  value: number;
}

interface RawGamepadDebug {
  index: number;
  id: string;
  mapping: string;
  connected: boolean;
  vendorId: string | null;
  productId: string | null;
  buttonsLength: number;
  axesLength: number;
  buttons: RawButtonDebug[];
  axes: RawAxisDebug[];
  pressedButtons: RawButtonDebug[];
  activeAxes: RawAxisDebug[];
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

function stickDeflection01(x: number, y: number) {
  const cx = Math.max(-1, Math.min(1, x));
  const cy = Math.max(-1, Math.min(1, y));

  return Math.min(1, Math.hypot(cx, cy));
}

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

function getRuntimePlatform() {
  if (typeof navigator === "undefined") {
    return "unknown";
  }

  const userAgentDataPlatform =
    "userAgentData" in navigator
      ? (navigator as Navigator & { userAgentData?: { platform?: string } })
          .userAgentData?.platform
      : undefined;
  const platformText =
    `${userAgentDataPlatform ?? ""} ${navigator.userAgent}`.toLowerCase();

  if (platformText.includes("linux")) return "linux";
  if (platformText.includes("mac")) return "mac";
  if (platformText.includes("win")) return "windows";

  return "unknown";
}

function getVendorProduct(id: string) {
  const match = /Vendor:\s*([0-9a-f]{4})\s+Product:\s*([0-9a-f]{4})/i.exec(id);

  return {
    vendorId: match?.[1]?.toLowerCase() ?? null,
    productId: match?.[2]?.toLowerCase() ?? null,
  };
}

function getRawGamepadsDebug(): RawGamepadDebug[] {
  if (typeof navigator === "undefined" || !navigator.getGamepads) {
    return [];
  }

  return Array.from(navigator.getGamepads())
    .filter((gamepad): gamepad is Gamepad => Boolean(gamepad))
    .map((gamepad) => {
      const { vendorId, productId } = getVendorProduct(gamepad.id);
      const buttons = gamepad.buttons.map((button, index) => ({
        index,
        pressed: button.pressed,
        value: button.value,
      }));
      const axes = gamepad.axes.map((value, index) => ({
        index,
        value,
      }));

      return {
        index: gamepad.index,
        id: gamepad.id,
        mapping: gamepad.mapping || "none",
        connected: gamepad.connected,
        vendorId,
        productId,
        buttonsLength: gamepad.buttons.length,
        axesLength: gamepad.axes.length,
        buttons,
        axes,
        pressedButtons: buttons.filter(
          (button) => button.pressed || button.value > 0.01
        ),
        activeAxes: axes.filter((axis) => Math.abs(axis.value) > 0.01),
      };
    });
}

function formatRawButtons(buttons: RawButtonDebug[]) {
  if (buttons.length === 0) return "None";

  return buttons
    .map((button) => `b${button.index}:${button.value.toFixed(2)}`)
    .join(", ");
}

function formatRawAxes(axes: RawAxisDebug[]) {
  if (axes.length === 0) return "None";

  return axes
    .map((axis) => `a${axis.index}:${axis.value.toFixed(2)}`)
    .join(", ");
}

function getInputRepeatLabel(
  activeInput: LocalInputDebug | null,
  lastInput: LocalInputDebug | null,
  now: number
) {
  if (activeInput && now - activeInput.startedAt >= 400) {
    return "held";
  }

  if (lastInput) {
    return "single";
  }

  return "None";
}

function getGamepadLabel(
  gamepad: { index: number; name: string } | null | undefined
) {
  if (!gamepad) return "None";

  return `#${gamepad.index} ${gamepad.name}`;
}

function getVendorProductLabel(gamepad: RawGamepadDebug | null) {
  if (!gamepad?.vendorId || !gamepad.productId) return "None";

  return `${gamepad.vendorId}:${gamepad.productId}`;
}

function getRawCountsLabel(gamepad: RawGamepadDebug | null) {
  if (!gamepad) return "None";

  return `${gamepad.buttonsLength} buttons / ${gamepad.axesLength} axes`;
}

function getActiveRawButtonsLabel(gamepad: RawGamepadDebug | null) {
  if (!gamepad) return "None";

  return formatRawButtons(gamepad.pressedButtons);
}

function getActiveRawAxesLabel(gamepad: RawGamepadDebug | null) {
  if (!gamepad) return "None";

  return formatRawAxes(gamepad.activeAxes);
}

function getLastEventLabel(event: GamepadEventDebug | null) {
  if (!event) return "None";

  return `#${event.gamepadIndex} ${event.source}.${event.label}`;
}

function getEventAgeLabel(event: GamepadEventDebug | null, now: number) {
  if (!event) return "None";

  return formatMs(now - event.startedAt);
}

function getEventStatusLabel(event: GamepadEventDebug | null) {
  if (!event) return "None";

  return `${event.status} -> active #${event.activeGamepadIndex ?? "none"}`;
}

function getEventEchoLabel(event: GamepadEventDebug | null) {
  if (event?.echoOfGamepadIndex === undefined) return "None";
  if (event.echoOfGamepadIndex === null) return "None";

  return `of #${event.echoOfGamepadIndex} (${formatMs(
    event.echoSuppressionMs ?? 0
  )})`;
}

function getFocusedActionsLabel(
  focusedDataset: ReturnType<typeof getFocusedElementDataset>
) {
  if (!focusedDataset) return "None";

  const actions = [
    focusedDataset.hasPrimary && "primary",
    focusedDataset.hasSecondary && "secondary",
    focusedDataset.hasPressX && "press.x",
    focusedDataset.hasPressY && "press.y",
    focusedDataset.hasHoldA && "hold.a",
    focusedDataset.hasHoldB && "hold.b",
    focusedDataset.hasHoldX && "hold.x",
  ].filter(Boolean);

  return actions.join(", ") || "None";
}

function getRegionPath(
  currentRegionId: string | null | undefined,
  regions: Array<{ id: string; parentRegionId: string | null }>
) {
  if (currentRegionId) {
    const path: string[] = [];
    let regionId: string | null = currentRegionId;

    while (regionId) {
      const region = regions.find((candidate) => candidate.id === regionId);

      if (!region) break;

      path.unshift(region.id);
      regionId = region.parentRegionId;
    }

    return path;
  }

  return [];
}

function getActiveInputLabel(
  pressedButtons: string[],
  leftStickDirection: GamepadAxisDirection | "none"
) {
  return (
    pressedButtons[0] ??
    (leftStickDirection === "none" ? null : `left-stick.${leftStickDirection}`)
  );
}

function getActiveInputSource(
  pressedButtons: string[]
): LocalInputDebug["source"] {
  return pressedButtons[0] ? "gamepad-button" : "left-stick";
}

function getHoldProgressLabel(
  activeInput: LocalInputDebug | null,
  now: number
) {
  if (!activeInput) return "None";

  return `${activeInput.label} ${formatMs(now - activeInput.startedAt)}`;
}

function getLastInputLabel(lastInput: LocalInputDebug | null) {
  if (!lastInput) return "None";

  return `${lastInput.source}.${lastInput.label}`;
}

function getItemStateLabel(
  currentNode: { navigationState: string } | null,
  focusedDataset: ReturnType<typeof getFocusedElementDataset>
) {
  return (
    currentNode?.navigationState ?? focusedDataset?.navigationState ?? "None"
  );
}

function getRememberedFocusLabel(
  currentRegionId: string | null | undefined,
  rememberedByRegionId: Record<string, string>
) {
  if (!currentRegionId) return "None";

  return rememberedByRegionId[currentRegionId] ?? "None";
}

function getConnectedGamepadsLabel(
  connectedGamepads: Array<{ index: number; layout: string }>,
  rawGamepads: RawGamepadDebug[]
) {
  if (connectedGamepads.length === 0) return "None";

  return connectedGamepads
    .map((gamepad) => {
      const rawGamepad = rawGamepads.find((raw) => raw.index === gamepad.index);
      const vendorProduct =
        rawGamepad?.vendorId && rawGamepad.productId
          ? ` ${rawGamepad.vendorId}:${rawGamepad.productId}`
          : "";
      const browserMapping = rawGamepad ? ` ${rawGamepad.mapping}` : "";

      return `#${gamepad.index}: ${gamepad.layout}${browserMapping}${vendorProduct}`;
    })
    .join(" · ");
}

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section style={{ display: "grid", gap: 6 }}>
      <strong style={{ color: "var(--primary)", fontSize: 12 }}>{title}</strong>
      <div style={{ display: "grid", gap: 4 }}>{children}</div>
    </section>
  );
}

function Row({
  label,
  value,
}: {
  readonly label: string;
  readonly value: ReactNode;
}) {
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

function AxisValue({
  label,
  value,
}: {
  readonly label: string;
  readonly value: number;
}) {
  const normalized = Math.max(0, Math.min(1, (value + 1) / 2));
  const height = `${Math.abs(value) * 50}%`;
  const top = value < 0 ? `${normalized * 100}%` : "50%";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "6px 1fr",
        gap: 6,
        alignItems: "center",
      }}
    >
      <div
        style={{
          position: "relative",
          width: 5,
          height: 34,
          backgroundColor: "var(--secondary)",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top,
            height,
            backgroundColor: "var(--text-secondary)",
          }}
        />
      </div>

      <div style={{ display: "grid", gap: 2 }}>
        <span style={{ color: "var(--text-secondary)", fontSize: 11 }}>
          {label}
        </span>
        <span style={{ color: "var(--text)", fontSize: 16 }}>
          {value.toFixed(5)}
        </span>
      </div>
    </div>
  );
}

function StickCircle({ x, y }: { readonly x: number; readonly y: number }) {
  const clampedX = Math.max(-1, Math.min(1, x));
  const clampedY = Math.max(-1, Math.min(1, y));
  const dotX = 56 + clampedX * 48;
  const dotY = 56 + clampedY * 48;

  return (
    <svg
      width="112"
      height="112"
      viewBox="0 0 112 112"
      fill="none"
      aria-label="Stick position"
    >
      <circle
        cx="56"
        cy="56"
        r="55"
        stroke="var(--secondary-border)"
        strokeWidth="1"
      />
      <line x1="1" y1="56" x2="111" y2="56" stroke="var(--secondary-border)" />
      <line x1="56" y1="1" x2="56" y2="111" stroke="var(--secondary-border)" />
      <line
        x1="56"
        y1="56"
        x2={dotX}
        y2={dotY}
        stroke="var(--text-secondary)"
      />
      <circle cx={dotX} cy={dotY} r="4" fill="var(--text)" />
    </svg>
  );
}

function StickPanel({
  title,
  x,
  y,
  xAxisLabel,
  yAxisLabel,
}: {
  readonly title: string;
  readonly x: number;
  readonly y: number;
  readonly xAxisLabel: string;
  readonly yAxisLabel: string;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "76px 112px",
        gap: "calc(var(--spacing-unit) * 3)",
        alignItems: "center",
      }}
    >
      <div style={{ display: "grid", gap: 6 }}>
        <span style={{ color: "var(--text-secondary)", fontSize: 11 }}>
          {title}
        </span>
        <AxisValue label={xAxisLabel} value={x} />
        <AxisValue label={yAxisLabel} value={y} />
      </div>

      <StickCircle x={x} y={y} />
    </div>
  );
}

function TriggerMeter({
  label,
  value,
}: {
  readonly label: string;
  readonly value: number;
}) {
  const normalized = Math.max(0, Math.min(1, value));

  return (
    <div style={{ display: "grid", gap: 5 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          color: "var(--text-secondary)",
          fontSize: 11,
        }}
      >
        <span>{label}</span>
        <span>{value.toFixed(5)}</span>
      </div>
      <div
        style={{
          height: 10,
          overflow: "hidden",
          borderRadius: 999,
          backgroundColor: "var(--secondary)",
        }}
      >
        <div
          style={{
            width: `${normalized * 100}%`,
            height: "100%",
            backgroundColor: "var(--text-secondary)",
          }}
        />
      </div>
    </div>
  );
}

function GamepadVisualizer({
  isButtonPressed,
  leftStickX,
  leftStickY,
  rightStickX,
  rightStickY,
  leftTriggerValue,
  rightTriggerValue,
  isInfiniteVibrationEnabled,
  onTestVibration,
  onToggleInfiniteVibration,
}: {
  readonly isButtonPressed: (button: GamepadButtonType) => boolean;
  readonly leftStickX: number;
  readonly leftStickY: number;
  readonly rightStickX: number;
  readonly rightStickY: number;
  readonly leftTriggerValue: number;
  readonly rightTriggerValue: number;
  readonly isInfiniteVibrationEnabled: boolean;
  readonly onTestVibration: () => void;
  readonly onToggleInfiniteVibration: () => void;
}) {
  const activeFill = "#ffffff";
  const bodyFill = "var(--secondary)";
  const line = "var(--text-secondary)";
  const softLine = "var(--secondary-border)";
  const activeText = "var(--background)";
  const inactiveFill = "var(--surface)";
  const leftStickDotX = 113 + Math.max(-1, Math.min(1, leftStickX)) * 16;
  const leftStickDotY = 160 + Math.max(-1, Math.min(1, leftStickY)) * 16;
  const rightStickDotX = 278 + Math.max(-1, Math.min(1, rightStickX)) * 16;
  const rightStickDotY = 238 + Math.max(-1, Math.min(1, rightStickY)) * 16;
  const leftStickDeflection = stickDeflection01(leftStickX, leftStickY);
  const rightStickDeflection = stickDeflection01(rightStickX, rightStickY);
  const leftTrigger01 = Math.max(0, Math.min(1, leftTriggerValue));
  const rightTrigger01 = Math.max(0, Math.min(1, rightTriggerValue));

  const buttonFill = (button: GamepadButtonType) =>
    isButtonPressed(button) ? activeFill : inactiveFill;
  const buttonText = (button: GamepadButtonType) =>
    isButtonPressed(button) ? activeText : line;
  const dpadFill = (button: GamepadButtonType) =>
    isButtonPressed(button) ? activeFill : "transparent";

  return (
    <div
      style={{
        padding: "calc(var(--spacing-unit) * 3)",
        borderRadius: "calc(var(--spacing-unit) * 4)",
        border: "1px solid var(--secondary-border)",
        backgroundColor: "var(--background)",
      }}
    >
      <svg
        width="100%"
        viewBox="0 0 441 403"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="Gamepad input visualizer"
      >
        <path
          d="M220.5 92.0001C200.5 92.0001 154 92.0001 128 92.0001C95.5 92.0001 66.5 109.5 55 137.5C43.5 165.5 4 271.1 4 317.5C4 363.9 17.5 378.5 49.5 378.5C81.5 378.5 105 294.5 150 294.5C195 294.5 220.5 294.5 220.5 294.5C220.5 294.5 245.5 294.5 290.5 294.5C335.5 294.5 359 378.5 391 378.5C423 378.5 436.5 363.9 436.5 317.5C436.5 271.1 397 165.5 385.5 137.5C374 109.5 345 92.0001 312.5 92.0001C286.5 92.0001 240 92.0001 220.5 92.0001Z"
          fill={bodyFill}
          stroke={line}
          strokeWidth="3"
        />
        <line
          x1="30"
          y1="210"
          x2="130"
          y2="300"
          strokeWidth="3"
          stroke={softLine}
        />
        <line
          x1="411"
          y1="210"
          x2="311"
          y2="300"
          strokeWidth="3"
          stroke={softLine}
        />

        <g>
          <path
            d="M152.5 37C152.5 41.1421 149.142 44.5 145 44.5H132C127.858 44.5 124.5 41.1421 124.5 37V16.5C124.5 8.76801 130.768 2.5 138.5 2.5C146.232 2.5 152.5 8.76801 152.5 16.5V37Z"
            fill={inactiveFill}
            stroke={line}
            strokeWidth="3"
          />
          <path
            d="M152.5 37C152.5 41.1421 149.142 44.5 145 44.5H132C127.858 44.5 124.5 41.1421 124.5 37V16.5C124.5 8.76801 130.768 2.5 138.5 2.5C146.232 2.5 152.5 8.76801 152.5 16.5V37Z"
            fill={activeFill}
            fillOpacity={leftTrigger01}
          />
        </g>
        <g>
          <path
            d="M317.5 37C317.5 41.1421 314.142 44.5 310 44.5H297C292.858 44.5 289.5 41.1421 289.5 37V16.5C289.5 8.76801 295.768 2.5 303.5 2.5C311.232 2.5 317.5 8.76801 317.5 16.5V37Z"
            fill={inactiveFill}
            stroke={line}
            strokeWidth="3"
          />
          <path
            d="M317.5 37C317.5 41.1421 314.142 44.5 310 44.5H297C292.858 44.5 289.5 41.1421 289.5 37V16.5C289.5 8.76801 295.768 2.5 303.5 2.5C311.232 2.5 317.5 8.76801 317.5 16.5V37Z"
            fill={activeFill}
            fillOpacity={rightTrigger01}
          />
        </g>
        <rect
          x="111.5"
          y="61.5"
          width="41"
          height="13"
          rx="6.5"
          fill={buttonFill(GamepadButtonType.LEFT_BUMPER)}
          stroke={line}
          strokeWidth="3"
        />
        <rect
          x="289.5"
          y="61.5"
          width="41"
          height="13"
          rx="6.5"
          fill={buttonFill(GamepadButtonType.RIGHT_BUMPER)}
          stroke={line}
          strokeWidth="3"
        />

        <circle cx="113" cy="160" r="37.5" stroke={softLine} strokeWidth="3" />
        <circle cx="278" cy="238" r="37.5" stroke={softLine} strokeWidth="3" />
        <circle cx="166" cy="238" r="37.5" stroke={softLine} strokeWidth="3" />
        <circle cx="329" cy="160" r="37.5" stroke={softLine} strokeWidth="3" />

        <circle
          cx="113"
          cy="160"
          r="28"
          fill={inactiveFill}
          stroke={line}
          strokeWidth="3"
        />
        <circle cx={leftStickDotX} cy={leftStickDotY} r="14" fill={softLine} />
        <circle
          cx={leftStickDotX}
          cy={leftStickDotY}
          r="14"
          fill={activeFill}
          fillOpacity={leftStickDeflection}
        />
        <circle
          cx="278"
          cy="238"
          r="28"
          fill={inactiveFill}
          stroke={line}
          strokeWidth="3"
        />
        <circle
          cx={rightStickDotX}
          cy={rightStickDotY}
          r="14"
          fill={softLine}
        />
        <circle
          cx={rightStickDotX}
          cy={rightStickDotY}
          r="14"
          fill={activeFill}
          fillOpacity={rightStickDeflection}
        />

        <path
          d="M177.669 222.335C180.793 219.21 180.816 213.997 176.868 212.014C176.327 211.743 175.776 211.491 175.215 211.258C172.182 210.002 168.931 209.355 165.648 209.355C162.365 209.355 159.114 210.002 156.081 211.258C155.521 211.491 154.969 211.743 154.429 212.014C150.48 213.997 150.503 219.21 153.627 222.335L159.991 228.698C163.116 231.823 168.181 231.823 171.305 228.698L177.669 222.335Z"
          fill={dpadFill(GamepadButtonType.DPAD_UP)}
          stroke={line}
          strokeWidth="3"
        />
        <path
          d="M181.447 249.669C184.571 252.793 189.785 252.816 191.768 248.868C192.039 248.327 192.291 247.776 192.523 247.215C193.78 244.182 194.426 240.931 194.426 237.648C194.426 234.365 193.78 231.114 192.523 228.081C192.291 227.521 192.039 226.969 191.768 226.429C189.785 222.48 184.571 222.503 181.447 225.627L175.083 231.991C171.959 235.116 171.959 240.181 175.083 243.305L181.447 249.669Z"
          fill={dpadFill(GamepadButtonType.DPAD_RIGHT)}
          stroke={line}
          strokeWidth="3"
        />
        <path
          d="M154.113 253.447C150.989 256.571 150.966 261.785 154.914 263.767C155.455 264.039 156.006 264.291 156.566 264.523C159.6 265.78 162.85 266.426 166.134 266.426C169.417 266.426 172.667 265.78 175.701 264.523C176.261 264.291 176.812 264.039 177.353 263.767C181.301 261.785 181.279 256.571 178.154 253.447L171.79 247.083C168.666 243.959 163.601 243.959 160.477 247.083L154.113 253.447Z"
          fill={dpadFill(GamepadButtonType.DPAD_DOWN)}
          stroke={line}
          strokeWidth="3"
        />
        <path
          d="M150.335 226.113C147.21 222.989 141.997 222.966 140.014 226.914C139.743 227.455 139.491 228.006 139.258 228.566C138.002 231.6 137.355 234.85 137.355 238.134C137.355 241.417 138.002 244.667 139.258 247.701C139.491 248.261 139.743 248.812 140.014 249.353C141.997 253.301 147.21 253.279 150.335 250.154L156.698 243.79C159.823 240.666 159.823 235.601 156.698 232.477L150.335 226.113Z"
          fill={dpadFill(GamepadButtonType.DPAD_LEFT)}
          stroke={line}
          strokeWidth="3"
        />

        {[
          { label: "Y", x: 329, y: 138, button: GamepadButtonType.BUTTON_Y },
          { label: "B", x: 351, y: 160, button: GamepadButtonType.BUTTON_B },
          { label: "A", x: 329, y: 182, button: GamepadButtonType.BUTTON_A },
          { label: "X", x: 307, y: 160, button: GamepadButtonType.BUTTON_X },
        ].map((item) => (
          <g key={item.label}>
            <circle
              cx={item.x}
              cy={item.y}
              r="13"
              fill={buttonFill(item.button)}
              stroke={line}
              strokeWidth="2"
            />
            <text
              x={item.x}
              y={item.y + 4}
              textAnchor="middle"
              fontSize="11"
              fontWeight="700"
              fill={buttonText(item.button)}
            >
              {item.label}
            </text>
          </g>
        ))}

        <circle
          cx="185"
          cy="162"
          r="10"
          fill={buttonFill(GamepadButtonType.BACK)}
          stroke={line}
          strokeWidth="3"
        />
        <circle
          cx="259"
          cy="162"
          r="10"
          fill={buttonFill(GamepadButtonType.START)}
          stroke={line}
          strokeWidth="3"
        />
      </svg>

      <div
        style={{
          display: "grid",
          gap: "calc(var(--spacing-unit) * 3)",
          marginTop: "calc(var(--spacing-unit) * 3)",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: "calc(var(--spacing-unit) * 4)",
          }}
        >
          <StickPanel
            title="L STICK"
            x={leftStickX}
            y={leftStickY}
            xAxisLabel="AXIS 0"
            yAxisLabel="AXIS 1"
          />
          <StickPanel
            title="R STICK"
            x={rightStickX}
            y={rightStickY}
            xAxisLabel="AXIS 2"
            yAxisLabel="AXIS 3"
          />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "calc(var(--spacing-unit) * 3)",
          }}
        >
          <TriggerMeter label="Left trigger" value={leftTriggerValue} />
          <TriggerMeter label="Right trigger" value={rightTriggerValue} />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "calc(var(--spacing-unit) * 3)",
          }}
        >
          <button
            type="button"
            onClick={onTestVibration}
            style={{
              color: "var(--text)",
              borderRadius: "calc(var(--spacing-unit) * 2)",
              backgroundColor: "var(--secondary)",
              padding:
                "calc(var(--spacing-unit) * 2) calc(var(--spacing-unit) * 3)",
              cursor: "pointer",
            }}
          >
            Vibration, 1 sec
          </button>
          <button
            type="button"
            onClick={onToggleInfiniteVibration}
            style={{
              color: "var(--text)",
              borderRadius: "calc(var(--spacing-unit) * 2)",
              backgroundColor: isInfiniteVibrationEnabled
                ? "var(--success)"
                : "var(--secondary)",
              padding:
                "calc(var(--spacing-unit) * 2) calc(var(--spacing-unit) * 3)",
              cursor: "pointer",
            }}
          >
            {isInfiniteVibrationEnabled ? "Stop vibration" : "Vibration, ∞"}
          </button>
        </div>
      </div>
    </div>
  );
}

function NavigationDiagnosticsPanel() {
  const [now, setNow] = useState(Date.now());
  const {
    isButtonPressed,
    getButtonValue,
    getAxisValue,
    onButtonPressed,
    onStickMove,
    vibrate,
    activeGamepadIndex,
    connectedGamepads,
    hasGamepadConnected,
  } = useGamepad();
  const getActiveGamepad = useGamepadStore((state) => state.getActiveGamepad);
  const { currentFocusId, nodes, regions, layers, debugSnapshot } =
    useNavigationSnapshot();
  const [lastInput, setLastInput] = useState<LocalInputDebug | null>(null);
  const [activeInput, setActiveInput] = useState<LocalInputDebug | null>(null);
  const [lastGamepadEvent, setLastGamepadEvent] =
    useState<GamepadEventDebug | null>(null);
  const [isInfiniteVibrationEnabled, setIsInfiniteVibrationEnabled] =
    useState(false);
  const activeGamepad = getActiveGamepad();
  const leftStickX = getAxisValue(GamepadAxisType.LEFT_STICK_X);
  const leftStickY = getAxisValue(GamepadAxisType.LEFT_STICK_Y);
  const rightStickX = getAxisValue(GamepadAxisType.RIGHT_STICK_X);
  const rightStickY = getAxisValue(GamepadAxisType.RIGHT_STICK_Y);
  const leftTriggerValue = getButtonValue(GamepadButtonType.LEFT_TRIGGER);
  const rightTriggerValue = getButtonValue(GamepadButtonType.RIGHT_TRIGGER);
  const leftStickDirection = getStickDirection(leftStickX, leftStickY);
  const runtimePlatform = getRuntimePlatform();
  const rawGamepads = getRawGamepadsDebug();
  const activeRawGamepad =
    rawGamepads.find((gamepad) => gamepad.index === activeGamepadIndex) ?? null;
  const pressedButtons = DEBUG_BUTTONS.filter(([, button]) =>
    isButtonPressed(button)
  ).map(([label]) => label);
  const currentNode = nodes.find((node) => node.id === currentFocusId) ?? null;
  const currentRegion = currentNode
    ? (regions.find((region) => region.id === currentNode.regionId) ?? null)
    : null;
  const [focusedDataset, setFocusedDataset] =
    useState<ReturnType<typeof getFocusedElementDataset>>(null);
  const activeInputLabel = getActiveInputLabel(
    pressedButtons,
    leftStickDirection
  );
  const activeInputSource = getActiveInputSource(pressedButtons);

  const regionPath = useMemo(() => {
    return getRegionPath(currentRegion?.id, regions);
  }, [currentRegion, regions]);

  useEffect(() => {
    if (!activeInput) {
      return;
    }

    const intervalId = globalThis.setInterval(() => {
      setNow(Date.now());
    }, 100);

    return () => {
      globalThis.clearInterval(intervalId);
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
    const unsubscribers = [
      ...DEBUG_BUTTONS.map(([label, button]) =>
        onButtonPressed(button, (event) => {
          const startedAt = Date.now();

          setLastGamepadEvent({
            gamepadIndex: event.gamepadIndex,
            label,
            source: "gamepad-button",
            status: event.status,
            accepted: event.accepted,
            activeGamepadIndex: event.activeGamepadIndex,
            echoOfGamepadIndex: event.echoOfGamepadIndex,
            echoSuppressionMs: event.echoSuppressionMs,
            startedAt,
          });
          setNow(startedAt);
        })
      ),
      ...[
        GamepadAxisDirection.UP,
        GamepadAxisDirection.DOWN,
        GamepadAxisDirection.LEFT,
        GamepadAxisDirection.RIGHT,
      ].map((direction) =>
        onStickMove("left", direction, (event) => {
          const startedAt = Date.now();

          setLastGamepadEvent({
            gamepadIndex: event.gamepadIndex,
            label: `${event.side}-stick.${event.direction}`,
            source: "left-stick",
            status: event.status,
            accepted: event.accepted,
            activeGamepadIndex: event.activeGamepadIndex,
            echoOfGamepadIndex: event.echoOfGamepadIndex,
            echoSuppressionMs: event.echoSuppressionMs,
            startedAt,
          });
          setNow(startedAt);
        })
      ),
    ];

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [onButtonPressed, onStickMove]);

  useEffect(() => {
    setFocusedDataset(getFocusedElementDataset(currentFocusId));
  }, [currentFocusId, currentNode?.navigationState]);

  useEffect(() => {
    if (!isInfiniteVibrationEnabled) {
      return;
    }

    vibrate({
      duration: 700,
      weakMagnitude: 0.45,
      strongMagnitude: 0.85,
    });

    const intervalId = globalThis.setInterval(() => {
      vibrate({
        duration: 700,
        weakMagnitude: 0.45,
        strongMagnitude: 0.85,
      });
    }, 650);

    return () => {
      globalThis.clearInterval(intervalId);
      vibrate({
        duration: 1,
        weakMagnitude: 0,
        strongMagnitude: 0,
      });
    };
  }, [isInfiniteVibrationEnabled, vibrate]);

  const handleTestVibration = () => {
    vibrate({
      duration: 1000,
      weakMagnitude: 0.45,
      strongMagnitude: 0.85,
    });
  };

  const handleLogSnapshot = () => {
    const snapshot = {
      gamepad: {
        hasGamepadConnected,
        connectedGamepads,
        activeGamepad,
        activeGamepadIndex,
        runtimePlatform,
        rawGamepads,
        pressedButtons,
        leftStick: {
          x: leftStickX,
          y: leftStickY,
          direction: leftStickDirection,
        },
      },
      input: {
        lastInput,
        activeInput,
        lastGamepadEvent,
      },
      navigation: {
        currentFocusId,
        currentNode,
        currentRegion,
        regionPath,
        layers,
        debugSnapshot,
      },
    };

    console.group("[navigation-diagnostics]");
    console.log("gamepad", snapshot.gamepad);
    console.log("input", snapshot.input);
    console.log("navigation", snapshot.navigation);
    console.groupEnd();

    let text: string;
    try {
      text = JSON.stringify(snapshot, null, 2);
    } catch (error) {
      console.warn("[navigation-diagnostics] snapshot JSON failed", error);
      text = `[navigation-diagnostics] JSON.stringify failed: ${String(error)}`;
    }

    navigator.clipboard.writeText(text).catch((err) => {
      console.warn("[navigation-diagnostics] clipboard copy failed", err);
    });
  };

  return (
    <div
      style={{
        flex: "1 1 auto",
        minWidth: 400,
        minHeight: 0,
        width: "max-content",
        maxWidth: "min(520px, calc(100vw - calc(var(--spacing-unit) * 12)))",
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
        <Row label="activeGamepad" value={getGamepadLabel(activeGamepad)} />
        <Row label="connected" value={connectedGamepads.length} />
        <Row label="activeIndex" value={activeGamepadIndex ?? "None"} />
        <Row label="layout" value={activeGamepad?.layout ?? "None"} />
        <Row label="platform" value={runtimePlatform} />
        <Row label="browserMap" value={activeRawGamepad?.mapping ?? "None"} />
        <Row label="vid/pid" value={getVendorProductLabel(activeRawGamepad)} />
        <Row label="rawCounts" value={getRawCountsLabel(activeRawGamepad)} />
        <Row
          label="pads"
          value={getConnectedGamepadsLabel(connectedGamepads, rawGamepads)}
        />
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
          label="rawButtons"
          value={getActiveRawButtonsLabel(activeRawGamepad)}
        />
        <Row label="rawAxes" value={getActiveRawAxesLabel(activeRawGamepad)} />
        <Row
          label="inputRepeat"
          value={getInputRepeatLabel(activeInput, lastInput, now)}
        />
        <Row
          label="holdProgress"
          value={getHoldProgressLabel(activeInput, now)}
        />
        <Row label="lastEventPad" value={getLastEventLabel(lastGamepadEvent)} />
        <Row label="eventAge" value={getEventAgeLabel(lastGamepadEvent, now)} />
        <Row
          label="eventStatus"
          value={getEventStatusLabel(lastGamepadEvent)}
        />
        <Row label="eventEcho" value={getEventEchoLabel(lastGamepadEvent)} />
      </Section>

      <Section title="Focus">
        <Row label="currentFocusId" value={currentFocusId ?? "None"} />
        <Row label="currentRegionId" value={currentRegion?.id ?? "None"} />
        <Row
          label="regionPath"
          value={regionPath.length > 0 ? regionPath.join(" > ") : "None"}
        />
        <Row label="orientation" value={currentRegion?.orientation ?? "None"} />
        <Row
          label="itemState"
          value={getItemStateLabel(currentNode, focusedDataset)}
        />
        <Row
          label="remembered"
          value={getRememberedFocusLabel(
            currentRegion?.id,
            debugSnapshot.lastFocusedByRegionId
          )}
        />
      </Section>

      <Section title="Movement">
        <Row label="lastInput" value={getLastInputLabel(lastInput)} />
        <Row label="moveResult" value="Not tracked by isolated debug" />
      </Section>

      <Section title="Actions">
        <Row label="lastAction" value="Not tracked by isolated debug" />
        <Row
          label="focusedActions"
          value={getFocusedActionsLabel(focusedDataset)}
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

      <Section title="Gamepad Visualizer">
        <GamepadVisualizer
          isButtonPressed={isButtonPressed}
          leftStickX={leftStickX}
          leftStickY={leftStickY}
          rightStickX={rightStickX}
          rightStickY={rightStickY}
          leftTriggerValue={leftTriggerValue}
          rightTriggerValue={rightTriggerValue}
          isInfiniteVibrationEnabled={isInfiniteVibrationEnabled}
          onTestVibration={handleTestVibration}
          onToggleInfiniteVibration={() => {
            setIsInfiniteVibrationEnabled((prev) => !prev);
          }}
        />
      </Section>
    </div>
  );
}

export function NavigationDiagnostics() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div
      style={{
        position: "fixed",
        right: "calc(var(--spacing-unit) * 6)",
        top: "calc(var(--spacing-unit) * 6)",
        bottom: "calc(var(--spacing-unit) * 6)",
        zIndex: 1000,
        display: "grid",
        gridTemplateRows: "minmax(0, 1fr)",
        alignContent: "end",
        justifyItems: "end",
        fontSize: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: "calc(var(--spacing-unit) * 3)",
          minHeight: 0,
          maxHeight: "100%",
          width: "max-content",
        }}
      >
        {isOpen && <NavigationDiagnosticsPanel />}

        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          style={{
            flexShrink: 0,
            marginTop: "auto",
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
    </div>
  );
}
