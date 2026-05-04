import { useCallback, useEffect, useRef } from "react";

export type GamepadDirection = "up" | "down" | "left" | "right";

export type GamepadAction =
  | { type: "navigate"; direction: GamepadDirection }
  | { type: "select" }
  | { type: "back" }
  | { type: "section-prev" }
  | { type: "section-next" }
  | { type: "menu" }
  | { type: "page-prev" }
  | { type: "page-next" }
  | { type: "scroll"; dx: number; dy: number };

interface UseGamepadOptions {
  enabled: boolean;
  onAction: (action: GamepadAction) => void;
}

const DEADZONE = 0.3;
const INITIAL_REPEAT_DELAY = 400;
const REPEAT_DELAY = 150;

export function useGamepad({ enabled, onAction }: UseGamepadOptions) {
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;

  const buttonState = useRef<Record<number, boolean>>({});
  const axisRepeat = useRef<
    Record<
      string,
      {
        active: boolean;
        timer: ReturnType<typeof setTimeout> | null;
        repeating: boolean;
      }
    >
  >({});

  const handleButtonPress = useCallback((index: number) => {
    switch (index) {
      case 0: // A
        onActionRef.current({ type: "select" });
        break;
      case 1: // B
        onActionRef.current({ type: "back" });
        break;
      case 4: // LB
        onActionRef.current({ type: "section-prev" });
        break;
      case 5: // RB
        onActionRef.current({ type: "section-next" });
        break;
      case 6: // LT
        onActionRef.current({ type: "page-prev" });
        break;
      case 7: // RT
        onActionRef.current({ type: "page-next" });
        break;
      case 9: // Start/Menu
        onActionRef.current({ type: "menu" });
        break;
      case 12: // D-pad up
        onActionRef.current({ type: "navigate", direction: "up" });
        break;
      case 13: // D-pad down
        onActionRef.current({ type: "navigate", direction: "down" });
        break;
      case 14: // D-pad left
        onActionRef.current({ type: "navigate", direction: "left" });
        break;
      case 15: // D-pad right
        onActionRef.current({ type: "navigate", direction: "right" });
        break;
    }
  }, []);

  const handleAxis = useCallback(
    (axisKey: string, direction: GamepadDirection, value: number) => {
      const isActive = Math.abs(value) > DEADZONE;
      const state = axisRepeat.current[axisKey];

      if (isActive && (!state || !state.active)) {
        onActionRef.current({ type: "navigate", direction });

        if (state?.timer) clearTimeout(state.timer);

        axisRepeat.current[axisKey] = {
          active: true,
          repeating: false,
          timer: setTimeout(function repeat() {
            onActionRef.current({ type: "navigate", direction });
            axisRepeat.current[axisKey] = {
              active: true,
              repeating: true,
              timer: setTimeout(repeat, REPEAT_DELAY),
            };
          }, INITIAL_REPEAT_DELAY),
        };
      } else if (!isActive && state?.active) {
        if (state.timer) clearTimeout(state.timer);
        axisRepeat.current[axisKey] = {
          active: false,
          repeating: false,
          timer: null,
        };
      }
    },
    []
  );

  useEffect(() => {
    if (!enabled) return;

    let rafId: number;

    const poll = () => {
      const gamepads = navigator.getGamepads();

      for (const gamepad of gamepads) {
        if (!gamepad) continue;

        // Handle buttons with edge detection
        for (let i = 0; i < gamepad.buttons.length; i++) {
          const pressed = gamepad.buttons[i].pressed;
          const wasPrevPressed = buttonState.current[i] ?? false;

          if (pressed && !wasPrevPressed) {
            handleButtonPress(i);
          }

          buttonState.current[i] = pressed;
        }

        // Handle left stick with deadzone
        if (gamepad.axes.length >= 2) {
          const lx = gamepad.axes[0];
          const ly = gamepad.axes[1];

          if (Math.abs(lx) > Math.abs(ly)) {
            handleAxis("lx", lx > 0 ? "right" : "left", lx);
            // Clear vertical when horizontal is dominant
            if (axisRepeat.current["ly"]?.active) {
              if (axisRepeat.current["ly"].timer)
                clearTimeout(axisRepeat.current["ly"].timer);
              axisRepeat.current["ly"] = {
                active: false,
                repeating: false,
                timer: null,
              };
            }
          } else {
            handleAxis("ly", ly > 0 ? "down" : "up", ly);
            if (axisRepeat.current["lx"]?.active) {
              if (axisRepeat.current["lx"].timer)
                clearTimeout(axisRepeat.current["lx"].timer);
              axisRepeat.current["lx"] = {
                active: false,
                repeating: false,
                timer: null,
              };
            }
          }
        }

        // Handle right stick for scrolling
        if (gamepad.axes.length >= 4) {
          const rx = gamepad.axes[2];
          const ry = gamepad.axes[3];
          const dx = Math.abs(rx) > DEADZONE ? rx : 0;
          const dy = Math.abs(ry) > DEADZONE ? ry : 0;

          if (dx !== 0 || dy !== 0) {
            onActionRef.current({ type: "scroll", dx, dy });
          }
        }
      }

      rafId = requestAnimationFrame(poll);
    };

    rafId = requestAnimationFrame(poll);

    return () => {
      cancelAnimationFrame(rafId);
      // Clear repeat timers
      for (const key of Object.keys(axisRepeat.current)) {
        if (axisRepeat.current[key]?.timer) {
          clearTimeout(axisRepeat.current[key].timer!);
        }
      }
      buttonState.current = {};
      axisRepeat.current = {};
    };
  }, [enabled, handleButtonPress, handleAxis]);
}
