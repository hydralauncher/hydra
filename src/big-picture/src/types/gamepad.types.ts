export enum GamepadButtonType {
  BUTTON_A = "buttonA",
  BUTTON_B = "buttonB",
  BUTTON_X = "buttonX",
  BUTTON_Y = "buttonY",
  LEFT_BUMPER = "leftBumper",
  RIGHT_BUMPER = "rightBumper",
  LEFT_TRIGGER = "leftTrigger",
  RIGHT_TRIGGER = "rightTrigger",
  DPAD_UP = "dpadUp",
  DPAD_DOWN = "dpadDown",
  DPAD_LEFT = "dpadLeft",
  DPAD_RIGHT = "dpadRight",
  LEFT_STICK_PRESS = "leftStickPress",
  RIGHT_STICK_PRESS = "rightStickPress",
  BACK = "back",
  START = "start",
  HOME = "home",
  TRACKPAD = "trackpad",
}

export enum GamepadAxisType {
  LEFT_STICK_X = "leftStickX",
  LEFT_STICK_Y = "leftStickY",
  RIGHT_STICK_X = "rightStickX",
  RIGHT_STICK_Y = "rightStickY",
}

export enum GamepadAxisDirection {
  LEFT = "left",
  RIGHT = "right",
  UP = "up",
  DOWN = "down",
  NONE = "none",
}

export type GamepadStickSide = "left" | "right";

export type GamepadInputStatus =
  | "accepted"
  | "ignored-duplicate-window"
  | "ignored-echo"
  | "ignored-inactive";

export interface GamepadInputEventMeta {
  status: GamepadInputStatus;
  accepted: boolean;
  activeGamepadIndex: number | null;
  previousActiveGamepadIndex: number | null;
  echoOfGamepadIndex?: number | null;
  echoSuppressionMs?: number | null;
}

export interface GamepadButtonPressEvent extends GamepadInputEventMeta {
  gamepadIndex: number;
  button: GamepadButtonType;
}

export interface GamepadStickMoveEvent extends GamepadInputEventMeta {
  gamepadIndex: number;
  side: GamepadStickSide;
  direction: GamepadAxisDirection;
}

export interface GamepadVibrationOptions {
  duration?: number;
  weakMagnitude?: number;
  strongMagnitude?: number;
  gamepadIndex?: number;
}
