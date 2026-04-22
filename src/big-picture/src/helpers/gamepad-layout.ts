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
  { index: 0, source: "axis", type: GamepadAxisType.LEFT_STICK_X },
  { index: 1, source: "axis", type: GamepadAxisType.LEFT_STICK_Y },
  { index: 2, source: "axis", type: GamepadAxisType.RIGHT_STICK_X },
  { index: 3, source: "axis", type: GamepadAxisType.RIGHT_STICK_Y },
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
  {
    axis: 7,
    source: "axis-button",
    direction: "negative",
    type: GamepadButtonType.DPAD_UP,
  },
  {
    axis: 7,
    source: "axis-button",
    direction: "positive",
    type: GamepadButtonType.DPAD_DOWN,
  },
  {
    axis: 6,
    source: "axis-button",
    direction: "negative",
    type: GamepadButtonType.DPAD_LEFT,
  },
  {
    axis: 6,
    source: "axis-button",
    direction: "positive",
    type: GamepadButtonType.DPAD_RIGHT,
  },
  { index: 0, source: "axis", type: GamepadAxisType.LEFT_STICK_X },
  { index: 1, source: "axis", type: GamepadAxisType.LEFT_STICK_Y },
  { index: 3, source: "axis", type: GamepadAxisType.RIGHT_STICK_X },
  { index: 4, source: "axis", type: GamepadAxisType.RIGHT_STICK_Y },
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
  {
    axis: 1,
    source: "axis-button",
    direction: "negative",
    type: GamepadButtonType.DPAD_UP,
  },
  {
    axis: 1,
    source: "axis-button",
    direction: "positive",
    type: GamepadButtonType.DPAD_DOWN,
  },
  {
    axis: 0,
    source: "axis-button",
    direction: "negative",
    type: GamepadButtonType.DPAD_LEFT,
  },
  {
    axis: 0,
    source: "axis-button",
    direction: "positive",
    type: GamepadButtonType.DPAD_RIGHT,
  },
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
  {
    axis: 5,
    source: "axis-button",
    direction: "negative",
    type: GamepadButtonType.DPAD_UP,
  },
  {
    axis: 5,
    source: "axis-button",
    direction: "positive",
    type: GamepadButtonType.DPAD_DOWN,
  },
  {
    axis: 4,
    source: "axis-button",
    direction: "negative",
    type: GamepadButtonType.DPAD_LEFT,
  },
  {
    axis: 4,
    source: "axis-button",
    direction: "positive",
    type: GamepadButtonType.DPAD_RIGHT,
  },
  { index: 0, source: "axis", type: GamepadAxisType.LEFT_STICK_X },
  { index: 1, source: "axis", type: GamepadAxisType.LEFT_STICK_Y },
  { index: 3, source: "axis", type: GamepadAxisType.RIGHT_STICK_X },
  { index: 2, source: "axis", type: GamepadAxisType.RIGHT_STICK_Y },
];

const LINUX_DRAGONRISE_MAPPINGS: GamepadInputMapping[] = [
  ...STANDARD_GAMEPAD_MAPPINGS,
  {
    axis: 6,
    source: "axis-button",
    direction: "negative",
    type: GamepadButtonType.DPAD_UP,
  },
  {
    axis: 6,
    source: "axis-button",
    direction: "positive",
    type: GamepadButtonType.DPAD_DOWN,
  },
  {
    axis: 5,
    source: "axis-button",
    direction: "negative",
    type: GamepadButtonType.DPAD_LEFT,
  },
  {
    axis: 5,
    source: "axis-button",
    direction: "positive",
    type: GamepadButtonType.DPAD_RIGHT,
  },
  { index: 0, source: "axis", type: GamepadAxisType.LEFT_STICK_X },
  { index: 1, source: "axis", type: GamepadAxisType.LEFT_STICK_Y },
  { index: 3, source: "axis", type: GamepadAxisType.RIGHT_STICK_X },
  { index: 4, source: "axis", type: GamepadAxisType.RIGHT_STICK_Y },
];

const GAMEPAD_LAYOUTS: GamepadLayout[] = [
  {
    name: "Linux XInput Controller",
    platforms: ["linux"],
    idPatterns: [
      /xinput/i,
      /xbox/i,
      /xbox 360/i,
      /Vendor:\s*045e\s+Product:\s*(028e|028f|0719)/i,
      /Vendor:\s*046d\s+Product:\s*(c21d|c21e|c21f)/i,
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
    name: "Standard Gamepad",
    idPatterns: [],
    mappings: STANDARD_GAMEPAD_MAPPINGS,
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
  if (typeof navigator === "undefined") {
    return "unknown";
  }

  const platform = navigator.platform.toLowerCase();
  const userAgent = navigator.userAgent.toLowerCase();
  const platformText = `${platform} ${userAgent}`;

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
)!;

export const getGamepadLayout = (gamepad: globalThis.Gamepad) => {
  console.log("getGamepadLayout", gamepad.id);
  const platform = getGamepadPlatform();

  for (const layout of GAMEPAD_LAYOUTS) {
    if (
      isLayoutAvailableForPlatform(layout, platform) &&
      layout.idPatterns.some((pattern: RegExp) => pattern.test(gamepad.id))
    ) {
      return layout;
    }
  }

  return STANDARD_GAMEPAD_LAYOUT;
};
