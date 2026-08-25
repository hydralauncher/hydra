import { useEffect, useRef, useState } from "react";
import { subscribe, unsubscribe } from "./gamepad-controller";
import { GAMEPAD_BUTTONS, type GamepadButton } from "./gamepad-constants";

export { GAMEPAD_BUTTONS, type GamepadButton };

type GamepadEventMap = {
  [K in GamepadButton]?: () => boolean | void;
};

interface UseGamepadOptions {
  onButton?: GamepadEventMap;
  priority?: number;
}

export function useGamepadConnected(): boolean {
  const [connected, setConnected] = useState(() =>
    Array.from(navigator.getGamepads()).some((p) => p !== null)
  );

  useEffect(() => {
    const check = () => {
      setConnected(Array.from(navigator.getGamepads()).some((p) => p !== null));
    };

    const interval = setInterval(check, 500);
    window.addEventListener("gamepadconnected", check);
    window.addEventListener("gamepaddisconnected", () =>
      setTimeout(check, 100)
    );

    return () => {
      clearInterval(interval);
      window.removeEventListener("gamepadconnected", check);
      window.removeEventListener("gamepaddisconnected", check);
    };
  }, []);

  return connected;
}

export function useGamepad({
  onButton = {},
  priority = 0,
}: UseGamepadOptions = {}): void {
  const onButtonRef = useRef(onButton);
  useEffect(() => {
    onButtonRef.current = onButton;
  }, [onButton]);

  useEffect(() => {
    // Registra apenas os botões que têm handler — evita "consumir" sem handler
    const handlers: GamepadEventMap = {};
    (Object.keys(onButton) as GamepadButton[]).forEach((key) => {
      handlers[key] = () => onButtonRef.current[key]?.();
    });

    const id = subscribe(handlers, priority);
    return () => unsubscribe(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priority]);
}
