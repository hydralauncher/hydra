import { GamepadAxisType, GamepadButtonType } from "@/types";

export interface GamepadButtonMapping {
  index: number;
  type: GamepadButtonType;
}

export interface GamepadAxisMapping {
  index: number;
  type: GamepadAxisType;
  invert?: boolean;
}

export interface GamepadLayout {
  name: string;
  buttons: GamepadButtonMapping[];
  axes: GamepadAxisMapping[];
  idPatterns: RegExp[];
}

const GAMEPAD_LAYOUTS: GamepadLayout[] = [
  {
    name: "Xbox Controller",
    idPatterns: [/xbox/i, /xinput/i, /microsoft/i, /xbox 360/i],
    buttons: [
      { index: 0, type: GamepadButtonType.BUTTON_A },
      { index: 1, type: GamepadButtonType.BUTTON_B },
      { index: 2, type: GamepadButtonType.BUTTON_X },
      { index: 3, type: GamepadButtonType.BUTTON_Y },
      { index: 4, type: GamepadButtonType.LEFT_BUMPER },
      { index: 5, type: GamepadButtonType.RIGHT_BUMPER },
      { index: 6, type: GamepadButtonType.LEFT_TRIGGER },
      { index: 7, type: GamepadButtonType.RIGHT_TRIGGER },
      { index: 8, type: GamepadButtonType.BACK },
      { index: 9, type: GamepadButtonType.START },
      { index: 10, type: GamepadButtonType.LEFT_STICK_PRESS },
      { index: 11, type: GamepadButtonType.RIGHT_STICK_PRESS },
      { index: 12, type: GamepadButtonType.DPAD_UP },
      { index: 13, type: GamepadButtonType.DPAD_DOWN },
      { index: 14, type: GamepadButtonType.DPAD_LEFT },
      { index: 15, type: GamepadButtonType.DPAD_RIGHT },
      { index: 16, type: GamepadButtonType.HOME },
    ],
    axes: [
      { index: 0, type: GamepadAxisType.LEFT_STICK_X },
      { index: 1, type: GamepadAxisType.LEFT_STICK_Y },
      { index: 2, type: GamepadAxisType.RIGHT_STICK_X },
      { index: 3, type: GamepadAxisType.RIGHT_STICK_Y },
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
    buttons: [
      { index: 0, type: GamepadButtonType.BUTTON_A },
      { index: 1, type: GamepadButtonType.BUTTON_B },
      { index: 2, type: GamepadButtonType.BUTTON_X },
      { index: 3, type: GamepadButtonType.BUTTON_Y },
      { index: 4, type: GamepadButtonType.LEFT_BUMPER },
      { index: 5, type: GamepadButtonType.RIGHT_BUMPER },
      { index: 6, type: GamepadButtonType.LEFT_TRIGGER },
      { index: 7, type: GamepadButtonType.RIGHT_TRIGGER },
      { index: 8, type: GamepadButtonType.BACK },
      { index: 9, type: GamepadButtonType.START },
      { index: 10, type: GamepadButtonType.LEFT_STICK_PRESS },
      { index: 11, type: GamepadButtonType.RIGHT_STICK_PRESS },
      { index: 12, type: GamepadButtonType.DPAD_UP },
      { index: 13, type: GamepadButtonType.DPAD_DOWN },
      { index: 14, type: GamepadButtonType.DPAD_LEFT },
      { index: 15, type: GamepadButtonType.DPAD_RIGHT },
      { index: 16, type: GamepadButtonType.HOME },
      { index: 17, type: GamepadButtonType.TRACKPAD },
    ],
    axes: [
      { index: 0, type: GamepadAxisType.LEFT_STICK_X },
      { index: 1, type: GamepadAxisType.LEFT_STICK_Y },
      { index: 2, type: GamepadAxisType.RIGHT_STICK_X },
      { index: 3, type: GamepadAxisType.RIGHT_STICK_Y },
    ],
  },
  {
    name: "Nintendo Switch Pro Controller",
    idPatterns: [/switch/i, /pro controller/i, /057e/i, /2009/i],
    buttons: [
      { index: 0, type: GamepadButtonType.BUTTON_A },
      { index: 1, type: GamepadButtonType.BUTTON_B },
      { index: 2, type: GamepadButtonType.BUTTON_X },
      { index: 3, type: GamepadButtonType.BUTTON_Y },
      { index: 4, type: GamepadButtonType.LEFT_BUMPER },
      { index: 5, type: GamepadButtonType.RIGHT_BUMPER },
      { index: 6, type: GamepadButtonType.LEFT_TRIGGER },
      { index: 7, type: GamepadButtonType.RIGHT_TRIGGER },
      { index: 8, type: GamepadButtonType.BACK },
      { index: 9, type: GamepadButtonType.START },
      { index: 10, type: GamepadButtonType.LEFT_STICK_PRESS },
      { index: 11, type: GamepadButtonType.RIGHT_STICK_PRESS },
      { index: 12, type: GamepadButtonType.DPAD_UP },
      { index: 13, type: GamepadButtonType.DPAD_DOWN },
      { index: 14, type: GamepadButtonType.DPAD_LEFT },
      { index: 15, type: GamepadButtonType.DPAD_RIGHT },
      { index: 16, type: GamepadButtonType.HOME },
    ],
    axes: [
      { index: 0, type: GamepadAxisType.LEFT_STICK_X },
      { index: 1, type: GamepadAxisType.LEFT_STICK_Y },
      { index: 2, type: GamepadAxisType.RIGHT_STICK_X },
      { index: 3, type: GamepadAxisType.RIGHT_STICK_Y },
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
