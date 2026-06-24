import { useInputModeStore } from "../stores";

export function useInputMode() {
  const mode = useInputModeStore((state) => state.mode);
  const setGamepadMode = useInputModeStore((state) => state.setGamepadMode);
  const setMouseMode = useInputModeStore((state) => state.setMouseMode);

  return {
    mode,
    isGamepad: mode === "gamepad",
    isMouse: mode === "mouse",
    setGamepadMode,
    setMouseMode,
  };
}
