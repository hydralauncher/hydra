import { GamepadAxisType, GamepadButtonType } from "../types";

export type GamepadAxisButtonDirection = "negative" | "positive";
export type GamepadPlatform = "linux" | "windows" | "mac" | "unknown";

export interface GamepadPhysicalButtonMapping {
  index: number;
  source: "button";
  type: GamepadButtonType;
}

export interface GamepadPhysicalAxisMapping {
  index: number;
  source: "axis";
  type: GamepadAxisType;
  invert?: boolean;
}

export interface GamepadAxisButtonMapping {
  axis: number;
  source: "axis-button";
  direction: GamepadAxisButtonDirection;
  type: GamepadButtonType;
  threshold?: number;
}

export interface GamepadAxisTriggerMapping {
  axis: number;
  source: "axis-trigger";
  type: GamepadButtonType;
  min?: number;
  max?: number;
  threshold?: number;
}

export type GamepadInputMapping =
  | GamepadPhysicalButtonMapping
  | GamepadPhysicalAxisMapping
  | GamepadAxisButtonMapping
  | GamepadAxisTriggerMapping;

export interface GamepadLayout {
  name: string;
  mappings: GamepadInputMapping[];
  idPatterns: RegExp[];
  platforms?: GamepadPlatform[];
}

function makeAxisDpad(xAxis: number, yAxis: number): GamepadInputMapping[] {
  return [
    { axis: yAxis, source: "axis-button", direction: "negative", type: GamepadButtonType.DPAD_UP },
    { axis: yAxis, source: "axis-button", direction: "positive", type: GamepadButtonType.DPAD_DOWN },
    { axis: xAxis, source: "axis-button", direction: "negative", type: GamepadButtonType.DPAD_LEFT },
    { axis: xAxis, source: "axis-button", direction: "positive", type: GamepadButtonType.DPAD_RIGHT },
  ];
}

function makeStickAxes(
  lx: number,
  ly: number,
  rx: number,
  ry: number
): GamepadInputMapping[] {
  return [
    { index: lx, source: "axis", type: GamepadAxisType.LEFT_STICK_X },
    { index: ly, source: "axis", type: GamepadAxisType.LEFT_STICK_Y },
    { index: rx, source: "axis", type: GamepadAxisType.RIGHT_STICK_X },
    { index: ry, source: "axis", type: GamepadAxisType.RIGHT_STICK_Y },
  ];
}

const STANDARD_GAMEPAD_MAPPINGS: GamepadInputMapping[] = [
  { index: 0, source: "button", type: GamepadButtonType.BUTTON_A },
  { index: 1, source: "button", type: GamepadButtonType.BUTTON_B },
  { index: 2, source: "button", type: GamepadButtonType.BUTTON_X },
  { index: 3, source: "button", type: GamepadButtonType.BUTTON_Y },
  { index: 4, source: "button", type: GamepadButtonType.LEFT_BUMPER },
  { index: 5, source: "button", type: GamepadButtonType.RIGHT_BUMPER },
  { index: 6, source: "button", type: GamepadButtonType.LEFT_TRIGGER },
  { index: 7, source: "button", type: GamepadButtonType.RIGHT_TRIGGER },
  { index: 8, source: "button", type: GamepadButtonType.BACK },
  { index: 9, source: "button", type: GamepadButtonType.START },
  { index: 10, source: "button", type: GamepadButtonType.LEFT_STICK_PRESS },
  { index: 11, source: "button", type: GamepadButtonType.RIGHT_STICK_PRESS },
  { index: 12, source: "button", type: GamepadButtonType.DPAD_UP },
  { index: 13, source: "button", type: GamepadButtonType.DPAD_DOWN },
  { index: 14, source: "button", type: GamepadButtonType.DPAD_LEFT },
  { index: 15, source: "button", type: GamepadButtonType.DPAD_RIGHT },
  { index: 16, source: "button", type: GamepadButtonType.HOME },
  ...makeStickAxes(0, 1, 2, 3),
];

const PLAYSTATION_GAMEPAD_MAPPINGS: GamepadInputMapping[] = [
  ...STANDARD_GAMEPAD_MAPPINGS,
  { index: 17, source: "button", type: GamepadButtonType.TRACKPAD },
];

const LINUX_XINPUT_MAPPINGS: GamepadInputMapping[] = [
  { index: 0, source: "button", type: GamepadButtonType.BUTTON_A },
  { index: 1, source: "button", type: GamepadButtonType.BUTTON_B },
  { index: 2, source: "button", type: GamepadButtonType.BUTTON_X },
  { index: 3, source: "button", type: GamepadButtonType.BUTTON_Y },
  { index: 4, source: "button", type: GamepadButtonType.LEFT_BUMPER },
  { index: 5, source: "button", type: GamepadButtonType.RIGHT_BUMPER },
  { axis: 2, source: "axis-trigger", type: GamepadButtonType.LEFT_TRIGGER },
  { axis: 5, source: "axis-trigger", type: GamepadButtonType.RIGHT_TRIGGER },
  { index: 6, source: "button", type: GamepadButtonType.BACK },
  { index: 7, source: "button", type: GamepadButtonType.START },
  { index: 8, source: "button", type: GamepadButtonType.HOME },
  { index: 9, source: "button", type: GamepadButtonType.LEFT_STICK_PRESS },
  { index: 10, source: "button", type: GamepadButtonType.RIGHT_STICK_PRESS },
  ...makeAxisDpad(6, 7),
  ...makeStickAxes(0, 1, 3, 4),
];

const LINUX_IBUFFALO_MAPPINGS: GamepadInputMapping[] = [
  { index: 1, source: "button", type: GamepadButtonType.BUTTON_A },
  { index: 0, source: "button", type: GamepadButtonType.BUTTON_B },
  { index: 3, source: "button", type: GamepadButtonType.BUTTON_X },
  { index: 2, source: "button", type: GamepadButtonType.BUTTON_Y },
  { index: 4, source: "button", type: GamepadButtonType.LEFT_TRIGGER },
  { index: 5, source: "button", type: GamepadButtonType.RIGHT_TRIGGER },
  { index: 6, source: "button", type: GamepadButtonType.BACK },
  { index: 7, source: "button", type: GamepadButtonType.START },
  ...makeAxisDpad(0, 1),
];

const LINUX_XGEAR_MAPPINGS: GamepadInputMapping[] = [
  { index: 2, source: "button", type: GamepadButtonType.BUTTON_A },
  { index: 1, source: "button", type: GamepadButtonType.BUTTON_B },
  { index: 3, source: "button", type: GamepadButtonType.BUTTON_X },
  { index: 0, source: "button", type: GamepadButtonType.BUTTON_Y },
  { index: 6, source: "button", type: GamepadButtonType.LEFT_BUMPER },
  { index: 7, source: "button", type: GamepadButtonType.RIGHT_BUMPER },
  { index: 4, source: "button", type: GamepadButtonType.LEFT_TRIGGER },
  { index: 5, source: "button", type: GamepadButtonType.RIGHT_TRIGGER },
  ...makeAxisDpad(4, 5),
  ...makeStickAxes(0, 1, 3, 2),
];

const LINUX_DRAGONRISE_MAPPINGS: GamepadInputMapping[] = [
  ...STANDARD_GAMEPAD_MAPPINGS,
  ...makeAxisDpad(5, 6),
  ...makeStickAxes(0, 1, 3, 4),
];

const LINUX_8BITDO_ULTIMATE2_DI_MAPPINGS: GamepadInputMapping[] = [
  { index: 0, source: "button", type: GamepadButtonType.BUTTON_B },
  { index: 1, source: "button", type: GamepadButtonType.BUTTON_A },
  { index: 3, source: "button", type: GamepadButtonType.BUTTON_Y },
  { index: 4, source: "button", type: GamepadButtonType.BUTTON_X },
  { index: 6, source: "button", type: GamepadButtonType.LEFT_BUMPER },
  { index: 7, source: "button", type: GamepadButtonType.RIGHT_BUMPER },
  { index: 8, source: "button", type: GamepadButtonType.LEFT_TRIGGER },
  { index: 9, source: "button", type: GamepadButtonType.RIGHT_TRIGGER },
  { index: 10, source: "button", type: GamepadButtonType.BACK },
  { index: 11, source: "button", type: GamepadButtonType.START },
  { index: 13, source: "button", type: GamepadButtonType.LEFT_STICK_PRESS },
  { index: 14, source: "button", type: GamepadButtonType.RIGHT_STICK_PRESS },
  { index: 15, source: "button", type: GamepadButtonType.HOME },
  ...makeAxisDpad(4, 5),
  ...makeStickAxes(0, 1, 2, 3),
];

const GAMEPAD_LAYOUTS: GamepadLayout[] = [
  {
    name: "Linux XInput Controller",
    platforms: ["linux"],
    idPatterns: [
      /xinput/i,
      /x[-\s]?box/i,
      /xbox/i,
      /xbox 360/i,
      /Vendor:\s*045e\s+Product:\s*(028e|028f|0719)/i,
      /Vendor:\s*046d\s+Product:\s*(c21d|c21e|c21f)/i,
      /Vendor:\s*3537\s+Product:\s*100b/i,
    ],
    mappings: LINUX_XINPUT_MAPPINGS,
  },
  {
    name: "Linux DragonRise Generic USB",
    platforms: ["linux"],
    idPatterns: [/Vendor:\s*0079\s+Product:\s*0006/i],
    mappings: LINUX_DRAGONRISE_MAPPINGS,
  },
  {
    name: "Linux iBuffalo Classic",
    platforms: ["linux"],
    idPatterns: [/Vendor:\s*0583\s+Product:\s*2060/i],
    mappings: LINUX_IBUFFALO_MAPPINGS,
  },
  {
    name: "Linux XGEAR PS2 Controller",
    platforms: ["linux"],
    idPatterns: [/Vendor:\s*0e8f\s+Product:\s*0003/i],
    mappings: LINUX_XGEAR_MAPPINGS,
  },
  {
    name: "Linux 8BitDo Ultimate Wireless Controller (XInput)",
    platforms: ["linux"],
    idPatterns: [/Vendor:\s*2dc8\s+Product:\s*3106/i],
    mappings: STANDARD_GAMEPAD_MAPPINGS,
  },
  {
    name: "Linux 8BitDo Ultimate 2 Wireless Controller (DirectInput)",
    platforms: ["linux"],
    idPatterns: [/Vendor:\s*2dc8\s+Product:\s*3109/i],
    mappings: LINUX_8BITDO_ULTIMATE2_DI_MAPPINGS,
  },
  {
    name: "Standard Gamepad",
    idPatterns: [],
    mappings: STANDARD_GAMEPAD_MAPPINGS,
  },
  {
    name: "Linux Standard Gamepad",
    platforms: ["linux"],
    idPatterns: [],
    mappings: LINUX_XINPUT_MAPPINGS,
  },
  {
    name: "Xbox Controller",
    idPatterns: [/xbox/i, /xinput/i, /microsoft/i, /xbox 360/i],
    mappings: STANDARD_GAMEPAD_MAPPINGS,
  },
  {
    name: "PlayStation Controller",
    idPatterns: [
      /playstation/i,
      /dualshock/i,
      /dualsense/i,
      /sony/i,
      /054c/i,
      /09cc/i,
      /0ce6/i,
    ],
    mappings: PLAYSTATION_GAMEPAD_MAPPINGS,
  },
  {
    name: "Nintendo Switch Pro Controller",
    idPatterns: [/switch/i, /pro controller/i, /057e/i, /2009/i],
    mappings: STANDARD_GAMEPAD_MAPPINGS,
  },
];

export const gamepadLayouts = GAMEPAD_LAYOUTS;

function getGamepadPlatform(): GamepadPlatform {
  const platformText = getNavigatorPlatformText();

  if (platformText.includes("linux")) return "linux";
  if (platformText.includes("mac")) return "mac";
  if (platformText.includes("win")) return "windows";

  return "unknown";
}

function isLayoutAvailableForPlatform(
  layout: GamepadLayout,
  platform: GamepadPlatform
) {
  return !layout.platforms || layout.platforms.includes(platform);
}

const STANDARD_GAMEPAD_LAYOUT = GAMEPAD_LAYOUTS.find(
  (layout) => layout.name === "Standard Gamepad"
);

const LINUX_STANDARD_GAMEPAD_LAYOUT = GAMEPAD_LAYOUTS.find(
  (layout) => layout.name === "Linux Standard Gamepad"
);

function getNavigatorPlatformText() {
  if (typeof navigator === "undefined") return "";

  const userAgentDataPlatform =
    "userAgentData" in navigator
      ? (navigator as Navigator & { userAgentData?: { platform?: string } })
          .userAgentData?.platform
      : undefined;

  return `${userAgentDataPlatform ?? ""} ${navigator.userAgent}`.toLowerCase();
}

export const getGamepadLayout = (gamepad: globalThis.Gamepad) => {
  if (gamepad.mapping === "standard") {
    return STANDARD_GAMEPAD_LAYOUT ?? GAMEPAD_LAYOUTS[0];
  }

  const platform = getGamepadPlatform();

  for (const layout of GAMEPAD_LAYOUTS) {
    if (
      isLayoutAvailableForPlatform(layout, platform) &&
      layout.idPatterns.some((pattern: RegExp) => pattern.test(gamepad.id))
    ) {
      return layout;
    }
  }

  if (platform === "linux" && LINUX_STANDARD_GAMEPAD_LAYOUT) {
    return LINUX_STANDARD_GAMEPAD_LAYOUT;
  }

  return STANDARD_GAMEPAD_LAYOUT ?? GAMEPAD_LAYOUTS[0];
};