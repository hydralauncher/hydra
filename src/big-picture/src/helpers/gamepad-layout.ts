import { GamepadAxisType, GamepadButtonType } from "../types";

export type GamepadAxisButtonDirection = "negative" | "positive";

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
}

const GAMEPAD_LAYOUTS: GamepadLayout[] = [
  {
    name: "Xbox Controller",
    idPatterns: [/xbox/i, /xinput/i, /microsoft/i, /xbox 360/i],
    mappings: [
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
      {
        index: 11,
        source: "button",
        type: GamepadButtonType.RIGHT_STICK_PRESS,
      },
      { index: 12, source: "button", type: GamepadButtonType.DPAD_UP },
      { index: 13, source: "button", type: GamepadButtonType.DPAD_DOWN },
      { index: 14, source: "button", type: GamepadButtonType.DPAD_LEFT },
      { index: 15, source: "button", type: GamepadButtonType.DPAD_RIGHT },
      { index: 16, source: "button", type: GamepadButtonType.HOME },
      { index: 0, source: "axis", type: GamepadAxisType.LEFT_STICK_X },
      { index: 1, source: "axis", type: GamepadAxisType.LEFT_STICK_Y },
      { index: 2, source: "axis", type: GamepadAxisType.RIGHT_STICK_X },
      { index: 3, source: "axis", type: GamepadAxisType.RIGHT_STICK_Y },
    ],
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
    mappings: [
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
      {
        index: 11,
        source: "button",
        type: GamepadButtonType.RIGHT_STICK_PRESS,
      },
      { index: 12, source: "button", type: GamepadButtonType.DPAD_UP },
      { index: 13, source: "button", type: GamepadButtonType.DPAD_DOWN },
      { index: 14, source: "button", type: GamepadButtonType.DPAD_LEFT },
      { index: 15, source: "button", type: GamepadButtonType.DPAD_RIGHT },
      { index: 16, source: "button", type: GamepadButtonType.HOME },
      { index: 17, source: "button", type: GamepadButtonType.TRACKPAD },
      { index: 0, source: "axis", type: GamepadAxisType.LEFT_STICK_X },
      { index: 1, source: "axis", type: GamepadAxisType.LEFT_STICK_Y },
      { index: 2, source: "axis", type: GamepadAxisType.RIGHT_STICK_X },
      { index: 3, source: "axis", type: GamepadAxisType.RIGHT_STICK_Y },
    ],
  },
  {
    name: "Nintendo Switch Pro Controller",
    idPatterns: [/switch/i, /pro controller/i, /057e/i, /2009/i],
    mappings: [
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
      {
        index: 11,
        source: "button",
        type: GamepadButtonType.RIGHT_STICK_PRESS,
      },
      { index: 12, source: "button", type: GamepadButtonType.DPAD_UP },
      { index: 13, source: "button", type: GamepadButtonType.DPAD_DOWN },
      { index: 14, source: "button", type: GamepadButtonType.DPAD_LEFT },
      { index: 15, source: "button", type: GamepadButtonType.DPAD_RIGHT },
      { index: 16, source: "button", type: GamepadButtonType.HOME },
      { index: 0, source: "axis", type: GamepadAxisType.LEFT_STICK_X },
      { index: 1, source: "axis", type: GamepadAxisType.LEFT_STICK_Y },
      { index: 2, source: "axis", type: GamepadAxisType.RIGHT_STICK_X },
      { index: 3, source: "axis", type: GamepadAxisType.RIGHT_STICK_Y },
    ],
  },
];

export const gamepadLayouts = GAMEPAD_LAYOUTS;

export const getGamepadLayout = (gamepad: globalThis.Gamepad) => {
  console.log("getGamepadLayout", gamepad.id);

  for (const layout of GAMEPAD_LAYOUTS) {
    if (layout.idPatterns.some((pattern: RegExp) => pattern.test(gamepad.id))) {
      return layout;
    }
  }

  return GAMEPAD_LAYOUTS[0];
};
