import {
  GamepadButtonType,
  GamepadAxisDirection,
  GamepadStickSide,
  GamepadAxisType,
  GamepadVibrationOptions,
} from "../types";
import { useGamepadStore } from "../stores";
import { useEffect, useRef, useCallback } from "react";

const DEFAULT_VIBRATION_DURATION = 200;
const DEFAULT_WEAK_MAGNITUDE = 0.5;
const DEFAULT_STRONG_MAGNITUDE = 0.5;

export interface UseGamepadReturn {
  isButtonPressed: (button: GamepadButtonType) => boolean;
  getButtonValue: (button: GamepadButtonType) => number;
  getAxisValue: (axis: GamepadAxisType) => number;
  vibrate: (options: GamepadVibrationOptions) => void;
  connectedGamepads: { index: number; name: string; layout: string }[];
  hasGamepadConnected: boolean;

  onButtonPressed: (
    button: GamepadButtonType,
    callback: () => void
  ) => () => void;

  onStickMove: (
    side: GamepadStickSide,
    direction: GamepadAxisDirection,
    callback: () => void
  ) => () => void;
}

export function useGamepad(): UseGamepadReturn {
  const {
    states,
    hasGamepadConnected,
    connectedGamepads,
    getActiveGamepad,
    getService,
    sync,
  } = useGamepadStore();

  const callbackRefs = useRef<Set<() => void>>(new Set());

  useEffect(() => {
    sync();
  }, [sync]);

  useEffect(() => {
    const currentCallbacks = callbackRefs.current;

    return () => {
      currentCallbacks.forEach((removeCallback) => removeCallback());
      currentCallbacks.clear();
    };
  }, []);

  const getButtonState = useCallback(
    (button: GamepadButtonType) => {
      if (!hasGamepadConnected) return null;

      const activeGamepad = getActiveGamepad();
      if (!activeGamepad) return null;

      const state = states.get(activeGamepad.index);
      if (!state) return null;

      return state.buttons.get(button) ?? null;
    },
    [hasGamepadConnected, getActiveGamepad, states]
  );

  const getAxisState = useCallback(
    (axis: GamepadAxisType) => {
      if (!hasGamepadConnected) return null;

      const activeGamepad = getActiveGamepad();
      if (!activeGamepad) return null;

      const state = states.get(activeGamepad.index);
      if (!state) return null;

      return state.axes.get(axis) ?? null;
    },
    [hasGamepadConnected, getActiveGamepad, states]
  );

  const isButtonPressed = useCallback(
    (button: GamepadButtonType) => {
      const buttonState = getButtonState(button);
      if (!buttonState) return false;

      return buttonState.pressed;
    },
    [getButtonState]
  );

  const getButtonValue = useCallback(
    (button: GamepadButtonType) => {
      const buttonState = getButtonState(button);
      if (!buttonState) return 0;

      return buttonState.value;
    },
    [getButtonState]
  );

  const getAxisValue = useCallback(
    (axis: GamepadAxisType) => {
      const axisState = getAxisState(axis);
      if (!axisState) return 0;

      return axisState.value;
    },
    [getAxisState]
  );

  const onButtonPressed = useCallback(
    (button: GamepadButtonType, callback: () => void) => {
      const service = getService();
      const removeCallback = service.onButtonPress(button, callback);

      callbackRefs.current.add(removeCallback);

      return () => {
        removeCallback();
        callbackRefs.current.delete(removeCallback);
      };
    },
    [getService]
  );

  const onStickMove = useCallback(
    (
      side: GamepadStickSide,
      direction: GamepadAxisDirection,
      callback: () => void
    ) => {
      const service = getService();
      const removeCallback = service.onStickMove(side, direction, callback);

      callbackRefs.current.add(removeCallback);

      return () => {
        removeCallback();
        callbackRefs.current.delete(removeCallback);
      };
    },
    [getService]
  );

  const vibrate = useCallback(
    (options: GamepadVibrationOptions = {}) => {
      const service = getService();
      const {
        duration = DEFAULT_VIBRATION_DURATION,
        weakMagnitude = DEFAULT_WEAK_MAGNITUDE,
        strongMagnitude = DEFAULT_STRONG_MAGNITUDE,
        gamepadIndex = getActiveGamepad()?.index ?? -1,
      } = options;

      service.vibrate(duration, weakMagnitude, strongMagnitude, gamepadIndex);
    },
    [getService, getActiveGamepad]
  );

  return {
    isButtonPressed,
    getButtonValue,
    getAxisValue,
    onButtonPressed,
    onStickMove,
    vibrate,
    hasGamepadConnected,
    connectedGamepads,
  };
}
