import { useEffect, useState, useCallback } from "react";
import "./virtual-keyboard.scss";
import { useGamepadContext } from "../../context/gamepad";
import { GamepadButton } from "../../types/gamepad.types";

interface VirtualKeyboardProps {
  readonly visible: boolean;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onClose: () => void;
  readonly onEnter: () => void;
}

const KEYBOARD_ROWS: ReadonlyArray<ReadonlyArray<string>> = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "Backspace"],
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["z", "x", "c", "v", "b", "n", "m", "Space", "Enter"],
];

export function VirtualKeyboard({
  visible,
  value,
  onChange,
  onClose,
  onEnter,
}: VirtualKeyboardProps) {
  const { subscribe } = useGamepadContext();

  // Track focused key coordinates [row, col]
  const [focusedKey, setFocusedKey] = useState([1, 0]); // Start at 'q'

  // Reset focus when opening
  useEffect(() => {
    if (visible) {
      setFocusedKey([1, 0]);
    }
  }, [visible]);

  const handleKeyPress = useCallback(
    (key: string) => {
      if (key === "Backspace") {
        onChange(value.slice(0, -1));
      } else if (key === "Space") {
        onChange(value + " ");
      } else if (key === "Enter") {
        onEnter();
      } else {
        onChange(value + key);
      }
    },
    [value, onChange, onEnter]
  );

  const moveFocus = useCallback(
    (direction: "up" | "down" | "left" | "right") => {
      setFocusedKey((prev) => {
        const [row, col] = prev;
        let nextRow = row;
        let nextCol = col;

        if (direction === "up") {
          nextRow = Math.max(0, row - 1);
          nextCol = Math.min(col, KEYBOARD_ROWS[nextRow].length - 1);
        } else if (direction === "down") {
          nextRow = Math.min(KEYBOARD_ROWS.length - 1, row + 1);
          nextCol = Math.min(col, KEYBOARD_ROWS[nextRow].length - 1);
        } else if (direction === "left") {
          nextCol = Math.max(0, col - 1);
        } else if (direction === "right") {
          nextCol = Math.min(KEYBOARD_ROWS[row].length - 1, col + 1);
        }

        return [nextRow, nextCol];
      });
    },
    []
  );

  // Handle gamepad input for navigation inside the keyboard
  useEffect(() => {
    if (!visible) return;

    let lastMoveTime = 0;
    const MOVE_THRESHOLD = 0.5; // Axis threshold
    const MOVE_COOLDOWN = 50; // ms between moves

    const unsubscribe = subscribe((event) => {
      const now = Date.now();

      if (event.type === "buttonpress") {
        const key = KEYBOARD_ROWS[focusedKey[0]][focusedKey[1]];
        switch (event.button) {
          case GamepadButton.A:
            if (key) handleKeyPress(key);
            break;
          case GamepadButton.B:
            onClose();
            break;
          case GamepadButton.X:
            handleKeyPress("Backspace");
            break;
          case GamepadButton.Start:
            onEnter();
            break;
          case GamepadButton.DPadUp:
            moveFocus("up");
            break;
          case GamepadButton.DPadDown:
            moveFocus("down");
            break;
          case GamepadButton.DPadLeft:
            moveFocus("left");
            break;
          case GamepadButton.DPadRight:
            moveFocus("right");
            break;
        }
      }

      // Axis Support (Left Stick)
      if (
        event.type === "axismove" &&
        event.axis === "leftStick" &&
        event.value
      ) {
        if (now - lastMoveTime < MOVE_COOLDOWN) return;

        const { x, y } = event.value;
        let moved = false;

        if (y < -MOVE_THRESHOLD) {
          moveFocus("up");
          moved = true;
        } else if (y > MOVE_THRESHOLD) {
          moveFocus("down");
          moved = true;
        } else if (x < -MOVE_THRESHOLD) {
          moveFocus("left");
          moved = true;
        } else if (x > MOVE_THRESHOLD) {
          moveFocus("right");
          moved = true;
        }

        if (moved) lastMoveTime = now;
      }
    });

    return unsubscribe;
  }, [
    visible,
    focusedKey,
    handleKeyPress,
    subscribe,
    onClose,
    onEnter,
    moveFocus,
  ]);

  if (!visible) return null;

  return (
    <div className="virtual-keyboard-overlay">
      <div className="virtual-keyboard">
        <div className="virtual-keyboard__header">
          <span className="virtual-keyboard__preview">
            {value || "Type to search..."}
          </span>
          <div className="virtual-keyboard__actions">
            <small>A: Select</small>
            <small>X: Backspace</small>
            <small>Start: Search</small>
            <small>B: Close</small>
          </div>
        </div>

        <div className="virtual-keyboard__grid">
          {KEYBOARD_ROWS.map((row, rowIndex) => (
            <div key={`row-${rowIndex}`} className="virtual-keyboard__row">
              {row.map((key, colIndex) => {
                const isFocused =
                  focusedKey[0] === rowIndex && focusedKey[1] === colIndex;
                let displayKey = key;
                if (key === "Backspace") displayKey = "⌫";
                if (key === "Enter") displayKey = "↵";
                if (key === "Space") displayKey = "Space";

                return (
                  <button
                    key={`${rowIndex}-${colIndex}`}
                    type="button"
                    className={`virtual-keyboard__key ${isFocused ? "focused" : ""} ${
                      key === "Space" ? "virtual-keyboard__key--space" : ""
                    } ${key === "Enter" || key === "Backspace" ? "virtual-keyboard__key--wide" : ""}`}
                    onClick={() => handleKeyPress(key)}
                  >
                    {displayKey}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
