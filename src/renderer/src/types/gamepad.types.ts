/**
 * Gamepad types and interfaces for controller support
 */

/** Standard gamepad button indices (Xbox layout) */
export enum GamepadButton {
  A = 0,
  B = 1,
  X = 2,
  Y = 3,
  LB = 4,
  RB = 5,
  LT = 6,
  RT = 7,
  Back = 8,
  Start = 9,
  LeftStick = 10,
  RightStick = 11,
  DPadUp = 12,
  DPadDown = 13,
  DPadLeft = 14,
  DPadRight = 15,
  Home = 16,
}

/** Standard gamepad axis indices */
export enum GamepadAxis {
  LeftStickX = 0,
  LeftStickY = 1,
  RightStickX = 2,
  RightStickY = 3,
}

/** Normalized gamepad state */
export interface GamepadState {
  id: string;
  index: number;
  connected: boolean;
  buttons: {
    [key in GamepadButton]?: {
      pressed: boolean;
      value: number;
    };
  };
  axes: {
    leftStick: { x: number; y: number };
    rightStick: { x: number; y: number };
  };
  timestamp: number;
}

/** Gamepad input event */
export interface GamepadInputEvent {
  type: "buttonpress" | "buttonrelease" | "axismove";
  button?: GamepadButton;
  axis?: "leftStick" | "rightStick";
  value?: { x: number; y: number };
  gamepadIndex: number;
}

/** Gamepad context value */
export interface GamepadContextValue {
  gamepads: GamepadState[];
  activeGamepad: GamepadState | null;
  isControllerMode: boolean;
  setControllerMode: (enabled: boolean) => void;
  subscribe: (callback: (event: GamepadInputEvent) => void) => () => void;
}

/** Controller mapping configuration */
export interface ControllerMapping {
  confirm: GamepadButton;
  cancel: GamepadButton;
  secondary: GamepadButton;
  tertiary: GamepadButton;
  prevSection: GamepadButton;
  nextSection: GamepadButton;
  menu: GamepadButton;
}

/** Default Xbox-style mapping */
export const DEFAULT_CONTROLLER_MAPPING: ControllerMapping = {
  confirm: GamepadButton.A,
  cancel: GamepadButton.B,
  secondary: GamepadButton.X,
  tertiary: GamepadButton.Y,
  prevSection: GamepadButton.LB,
  nextSection: GamepadButton.RB,
  menu: GamepadButton.Start,
};
