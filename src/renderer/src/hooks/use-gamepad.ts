import { useCallback, useEffect, useRef, useState } from "react";
import {
    GamepadState,
    GamepadButton,
    GamepadInputEvent,
} from "../types/gamepad.types";

/** Deadzone threshold for analog sticks */
const STICK_DEADZONE = 0.25;

/** Polling interval in milliseconds (roughly 60fps) */
const POLL_INTERVAL = 16;

/** Threshold for stick-to-dpad navigation conversion */
const STICK_NAV_THRESHOLD = 0.7;

/**
 * Normalizes a raw Gamepad object into our GamepadState interface
 */
function normalizeGamepad(gamepad: Gamepad): GamepadState {
    const applyDeadzone = (value: number): number => {
        return Math.abs(value) < STICK_DEADZONE ? 0 : value;
    };

    const buttons: GamepadState["buttons"] = {};
    gamepad.buttons.forEach((button, index) => {
        buttons[index as GamepadButton] = {
            pressed: button.pressed,
            value: button.value,
        };
    });

    return {
        id: gamepad.id,
        index: gamepad.index,
        connected: gamepad.connected,
        buttons,
        axes: {
            leftStick: {
                x: applyDeadzone(gamepad.axes[0] ?? 0),
                y: applyDeadzone(gamepad.axes[1] ?? 0),
            },
            rightStick: {
                x: applyDeadzone(gamepad.axes[2] ?? 0),
                y: applyDeadzone(gamepad.axes[3] ?? 0),
            },
        },
        timestamp: gamepad.timestamp,
    };
}

export interface UseGamepadOptions {
    /** Whether to enable gamepad polling */
    enabled?: boolean;
    /** Callback when a button is pressed */
    onButtonPress?: (button: GamepadButton, gamepadIndex: number) => void;
    /** Callback when a button is released */
    onButtonRelease?: (button: GamepadButton, gamepadIndex: number) => void;
    /** Callback for stick navigation (converted to D-pad style events) */
    onNavigate?: (
        direction: "up" | "down" | "left" | "right",
        gamepadIndex: number
    ) => void;
}

export interface UseGamepadReturn {
    /** List of connected gamepads */
    gamepads: GamepadState[];
    /** The primary (first connected) gamepad */
    activeGamepad: GamepadState | null;
    /** Whether any gamepad is connected */
    isConnected: boolean;
    /** Subscribe to gamepad input events */
    subscribe: (callback: (event: GamepadInputEvent) => void) => () => void;
}

/**
 * React hook for gamepad input handling using the Web Gamepad API.
 *
 * Features:
 * - Polls navigator.getGamepads() via requestAnimationFrame
 * - Handles gamepadconnected/gamepaddisconnected events
 * - Normalizes button/axis values across controller types
 * - Provides deadzone handling for analog sticks
 * - Converts stick input to navigation events
 *
 * @example
 * ```tsx
 * const { gamepads, activeGamepad, isConnected } = useGamepad({
 *   onButtonPress: (button) => {
 *     if (button === GamepadButton.A) {
 *       handleConfirm();
 *     }
 *   },
 *   onNavigate: (direction) => {
 *     moveFocus(direction);
 *   },
 * });
 * ```
 */
export function useGamepad(
    options: UseGamepadOptions = {}
): UseGamepadReturn {
    const { enabled = true, onButtonPress, onButtonRelease, onNavigate } =
        options;

    // Log initialization
    useEffect(() => {
        console.log("[Gamepad] Hook initialized, polling enabled:", enabled);
        console.log("[Gamepad] Available gamepads:", navigator.getGamepads());
    }, []);

    const [gamepads, setGamepads] = useState<GamepadState[]>([]);
    const subscribersRef = useRef<Set<(event: GamepadInputEvent) => void>>(
        new Set()
    );

    // Track previous button states for press/release detection
    const prevButtonStatesRef = useRef<Map<number, Map<GamepadButton, boolean>>>(
        new Map()
    );

    // Track previous stick states for navigation repeat prevention
    const prevStickNavRef = useRef<
        Map<number, { x: number; y: number; lastNav: number }>
    >(new Map());

    // Navigation repeat delay in ms
    const NAV_REPEAT_DELAY = 200;

    const emit = useCallback((event: GamepadInputEvent) => {
        subscribersRef.current.forEach((callback) => callback(event));
    }, []);

    const subscribe = useCallback(
        (callback: (event: GamepadInputEvent) => void) => {
            subscribersRef.current.add(callback);
            return () => {
                subscribersRef.current.delete(callback);
            };
        },
        []
    );

    const pollGamepads = useCallback(() => {
        const rawGamepads = navigator.getGamepads();
        const connectedGamepads: GamepadState[] = [];

        for (const gamepad of rawGamepads) {
            if (!gamepad) continue;

            const normalized = normalizeGamepad(gamepad);
            connectedGamepads.push(normalized);

            // Get or initialize previous button state for this gamepad
            if (!prevButtonStatesRef.current.has(gamepad.index)) {
                prevButtonStatesRef.current.set(gamepad.index, new Map());
            }
            const prevButtons = prevButtonStatesRef.current.get(gamepad.index)!;

            // Check for button press/release events
            for (const [buttonIndex, buttonState] of Object.entries(
                normalized.buttons
            )) {
                const button = parseInt(buttonIndex) as GamepadButton;
                const wasPressed = prevButtons.get(button) ?? false;
                const isPressed = buttonState?.pressed ?? false;

                if (isPressed && !wasPressed) {
                    // Button just pressed
                    onButtonPress?.(button, gamepad.index);
                    emit({
                        type: "buttonpress",
                        button,
                        gamepadIndex: gamepad.index,
                    });
                } else if (!isPressed && wasPressed) {
                    // Button just released
                    onButtonRelease?.(button, gamepad.index);
                    emit({
                        type: "buttonrelease",
                        button,
                        gamepadIndex: gamepad.index,
                    });
                }

                prevButtons.set(button, isPressed);
            }

            // Handle stick-to-navigation conversion
            const stick = normalized.axes.leftStick;
            const now = Date.now();

            if (!prevStickNavRef.current.has(gamepad.index)) {
                prevStickNavRef.current.set(gamepad.index, { x: 0, y: 0, lastNav: 0 });
            }
            const prevStick = prevStickNavRef.current.get(gamepad.index)!;

            // Check if enough time has passed for repeat navigation
            const canNavigate = now - prevStick.lastNav > NAV_REPEAT_DELAY;

            if (canNavigate) {
                let navigated = false;

                // Horizontal navigation
                if (stick.x > STICK_NAV_THRESHOLD && prevStick.x <= STICK_NAV_THRESHOLD) {
                    onNavigate?.("right", gamepad.index);
                    navigated = true;
                } else if (
                    stick.x < -STICK_NAV_THRESHOLD &&
                    prevStick.x >= -STICK_NAV_THRESHOLD
                ) {
                    onNavigate?.("left", gamepad.index);
                    navigated = true;
                }

                // Vertical navigation
                if (stick.y > STICK_NAV_THRESHOLD && prevStick.y <= STICK_NAV_THRESHOLD) {
                    onNavigate?.("down", gamepad.index);
                    navigated = true;
                } else if (
                    stick.y < -STICK_NAV_THRESHOLD &&
                    prevStick.y >= -STICK_NAV_THRESHOLD
                ) {
                    onNavigate?.("up", gamepad.index);
                    navigated = true;
                }

                if (navigated) {
                    prevStick.lastNav = now;
                }
            }

            prevStick.x = stick.x;
            prevStick.y = stick.y;
        }

        setGamepads(connectedGamepads);
    }, [onButtonPress, onButtonRelease, onNavigate, emit]);

    // Set up polling loop
    useEffect(() => {
        if (!enabled) return;

        let animationFrameId: number;
        let lastPollTime = 0;

        const loop = (timestamp: number) => {
            if (timestamp - lastPollTime >= POLL_INTERVAL) {
                pollGamepads();
                lastPollTime = timestamp;
            }
            animationFrameId = requestAnimationFrame(loop);
        };

        animationFrameId = requestAnimationFrame(loop);

        return () => {
            cancelAnimationFrame(animationFrameId);
        };
    }, [enabled, pollGamepads]);

    // Handle connection/disconnection events
    useEffect(() => {
        const handleConnected = (event: GamepadEvent) => {
            console.log(`Gamepad connected: ${event.gamepad.id}`);
            pollGamepads();
        };

        const handleDisconnected = (event: GamepadEvent) => {
            console.log(`Gamepad disconnected: ${event.gamepad.id}`);
            prevButtonStatesRef.current.delete(event.gamepad.index);
            prevStickNavRef.current.delete(event.gamepad.index);
            pollGamepads();
        };

        window.addEventListener("gamepadconnected", handleConnected);
        window.addEventListener("gamepaddisconnected", handleDisconnected);

        // Initial poll to catch already-connected gamepads
        pollGamepads();

        return () => {
            window.removeEventListener("gamepadconnected", handleConnected);
            window.removeEventListener("gamepaddisconnected", handleDisconnected);
        };
    }, [pollGamepads]);

    const activeGamepad = gamepads.length > 0 ? gamepads[0] : null;
    const isConnected = gamepads.length > 0;

    return {
        gamepads,
        activeGamepad,
        isConnected,
        subscribe,
    };
}
