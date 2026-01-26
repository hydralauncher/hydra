import { useEffect, useState, useCallback } from "react";
import "./virtual-keyboard.scss";
import { useGamepadContext } from "../../context/gamepad";
import { GamepadButton } from "../../types/gamepad.types";

interface VirtualKeyboardProps {
    visible: boolean;
    value: string;
    onChange: (value: string) => void;
    onClose: () => void;
    onEnter: () => void;
}

const KEYBOARD_ROWS = [
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

    // Handle gamepad input for navigation inside the keyboard
    useEffect(() => {
        if (!visible) return;

        let lastMoveTime = 0;
        const MOVE_THRESHOLD = 0.5; // Axis threshold
        const MOVE_COOLDOWN = 50; // ms between moves

        const unsubscribe = subscribe((event) => {
            const now = Date.now();

            if (event.type === "buttonpress") {
                if (event.button === GamepadButton.A) {
                    const row = KEYBOARD_ROWS[focusedKey[0]];
                    const key = row[focusedKey[1]];
                    if (key) handleKeyPress(key);
                } else if (event.button === GamepadButton.B) {
                    onClose();
                } else if (event.button === GamepadButton.X) {
                    handleKeyPress("Backspace");
                } else if (event.button === GamepadButton.Start) {
                    onEnter();
                } else if (event.button === GamepadButton.DPadUp) {
                    setFocusedKey((prev) => [Math.max(0, prev[0] - 1), Math.min(prev[1], KEYBOARD_ROWS[Math.max(0, prev[0] - 1)].length - 1)]);
                } else if (event.button === GamepadButton.DPadDown) {
                    setFocusedKey((prev) => [Math.min(KEYBOARD_ROWS.length - 1, prev[0] + 1), Math.min(prev[1], KEYBOARD_ROWS[Math.min(KEYBOARD_ROWS.length - 1, prev[0] + 1)].length - 1)]);
                } else if (event.button === GamepadButton.DPadLeft) {
                    setFocusedKey((prev) => [prev[0], Math.max(0, prev[1] - 1)]);
                } else if (event.button === GamepadButton.DPadRight) {
                    setFocusedKey((prev) => [prev[0], Math.min(KEYBOARD_ROWS[prev[0]].length - 1, prev[1] + 1)]);
                }
            }

            // Axis Support (Left Stick)
            if (event.type === "axismove" && event.axis === "leftStick" && event.value) {
                if (now - lastMoveTime < MOVE_COOLDOWN) return;

                const { x, y } = event.value;
                let moved = false;

                if (y < -MOVE_THRESHOLD) { // Up
                    setFocusedKey((prev) => [Math.max(0, prev[0] - 1), Math.min(prev[1], KEYBOARD_ROWS[Math.max(0, prev[0] - 1)].length - 1)]);
                    moved = true;
                } else if (y > MOVE_THRESHOLD) { // Down
                    setFocusedKey((prev) => [Math.min(KEYBOARD_ROWS.length - 1, prev[0] + 1), Math.min(prev[1], KEYBOARD_ROWS[Math.min(KEYBOARD_ROWS.length - 1, prev[0] + 1)].length - 1)]);
                    moved = true;
                } else if (x < -MOVE_THRESHOLD) { // Left
                    setFocusedKey((prev) => [prev[0], Math.max(0, prev[1] - 1)]);
                    moved = true;
                } else if (x > MOVE_THRESHOLD) { // Right
                    setFocusedKey((prev) => [prev[0], Math.min(KEYBOARD_ROWS[prev[0]].length - 1, prev[1] + 1)]);
                    moved = true;
                }

                if (moved) lastMoveTime = now;
            }
        });

        return unsubscribe;
    }, [visible, focusedKey, handleKeyPress, subscribe, onClose, onEnter]);

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
                        <div key={rowIndex} className="virtual-keyboard__row">
                            {row.map((key, colIndex) => {
                                const isFocused =
                                    focusedKey[0] === rowIndex && focusedKey[1] === colIndex;
                                let displayKey = key;
                                if (key === "Backspace") displayKey = "⌫";
                                if (key === "Enter") displayKey = "↵";
                                if (key === "Space") displayKey = "Space";

                                return (
                                    <button
                                        key={key}
                                        className={`virtual-keyboard__key ${isFocused ? "focused" : ""} ${key === "Space" ? "virtual-keyboard__key--space" : ""
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
