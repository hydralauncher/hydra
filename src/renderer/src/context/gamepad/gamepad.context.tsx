import {
    createContext,
    useContext,
    useState,
    useCallback,
    useEffect,
    type ReactNode,
} from "react";
import { useGamepad } from "../../hooks/use-gamepad";
import {
    GamepadButton,
    GamepadContextValue,
    DEFAULT_CONTROLLER_MAPPING,
    type ControllerMapping,
} from "../../types/gamepad.types";

const GamepadContext = createContext<GamepadContextValue | null>(null);

export interface GamepadProviderProps {
    children: ReactNode;
    /** Custom button mapping configuration */
    mapping?: ControllerMapping;
}

/**
 * Provides gamepad state and input events to the application.
 *
 * Wrap your app with this provider to enable controller support.
 *
 * @example
 * ```tsx
 * <GamepadProvider>
 *   <App />
 * </GamepadProvider>
 * ```
 */
export function GamepadProvider({
    children,
    mapping = DEFAULT_CONTROLLER_MAPPING,
}: GamepadProviderProps) {
    const [isControllerMode, setIsControllerMode] = useState(false);

    // Toggle controller-mode class on body for CSS styling
    useEffect(() => {
        if (isControllerMode) {
            document.body.classList.add("controller-mode");
            // Focus first focusable element if nothing is focused
            if (!document.activeElement || document.activeElement === document.body) {
                const focusables = getFocusableElements();
                if (focusables.length > 0) {
                    focusables[0].focus();
                }
            }
        } else {
            document.body.classList.remove("controller-mode");
        }
    }, [isControllerMode]);

    // Track mouse movement to exit controller mode
    useEffect(() => {
        let mouseMovedCount = 0;
        const handleMouseMove = () => {
            mouseMovedCount++;
            // Require multiple mouse moves to avoid accidental toggle
            if (isControllerMode && mouseMovedCount > 3) {
                setIsControllerMode(false);
                mouseMovedCount = 0;
            }
        };

        window.addEventListener("mousemove", handleMouseMove);
        return () => window.removeEventListener("mousemove", handleMouseMove);
    }, [isControllerMode]);

    const handleButtonPress = useCallback(
        (button: GamepadButton) => {
            console.log("[Gamepad] Button pressed:", GamepadButton[button] || button);

            // Any button press activates controller mode
            if (!isControllerMode) {
                console.log("[Gamepad] Activating controller mode");
                setIsControllerMode(true);
            }


            // Handle mapped actions
            if (button === mapping.confirm) {
                // Simulate click on focused element
                const focused = document.activeElement as HTMLElement;
                if (focused && focused !== document.body) {
                    focused.click();
                }
            } else if (button === mapping.cancel) {
                // Simulate browser back / close modal
                const modal = document.querySelector("[data-hydra-dialog]");
                if (modal) {
                    // Find and click close button in modal
                    const closeButton = modal.querySelector(
                        '[data-close-button], button[aria-label="Close"]'
                    ) as HTMLElement;
                    if (closeButton) {
                        closeButton.click();
                    }
                } else {
                    // Navigate back
                    window.history.back();
                }
            }

            // Handle D-pad as navigation
            if (button === GamepadButton.DPadUp) {
                navigateDirection("up");
            } else if (button === GamepadButton.DPadDown) {
                navigateDirection("down");
            } else if (button === GamepadButton.DPadLeft) {
                navigateDirection("left");
            } else if (button === GamepadButton.DPadRight) {
                navigateDirection("right");
            }
        },
        [isControllerMode, mapping]
    );

    const handleNavigate = useCallback(
        (direction: "up" | "down" | "left" | "right") => {
            if (!isControllerMode) {
                setIsControllerMode(true);
            }
            navigateDirection(direction);
        },
        [isControllerMode]
    );

    const { gamepads, activeGamepad, subscribe } = useGamepad({
        enabled: true,
        onButtonPress: handleButtonPress,
        onNavigate: handleNavigate,
    });

    const setControllerMode = useCallback((enabled: boolean) => {
        setIsControllerMode(enabled);
    }, []);

    const contextValue: GamepadContextValue = {
        gamepads,
        activeGamepad,
        isControllerMode,
        setControllerMode,
        subscribe,
    };

    return (
        <GamepadContext.Provider value={contextValue}>
            {children}
        </GamepadContext.Provider>
    );
}

/**
 * Hook to access gamepad context.
 * Must be used within a GamepadProvider.
 */
export function useGamepadContext(): GamepadContextValue {
    const context = useContext(GamepadContext);
    if (!context) {
        throw new Error("useGamepadContext must be used within a GamepadProvider");
    }
    return context;
}

/**
 * Simple tab-order navigation.
 * D-pad down/right = next element, D-pad up/left = previous element.
 * Much more reliable than spatial navigation.
 */
function navigateDirection(direction: "up" | "down" | "left" | "right") {
    const focusables = getFocusableElements();
    const current = document.activeElement as HTMLElement;

    if (!current || current === document.body || focusables.length === 0) {
        // No current focus, focus first element
        if (focusables.length > 0) {
            focusables[0].focus();
            // Instant scroll for snappy console-like feel
            focusables[0].scrollIntoView({ behavior: "instant", block: "nearest" });
        }
        return;
    }

    const currentIndex = focusables.indexOf(current);
    if (currentIndex === -1) {
        // Current element not in list, focus first
        focusables[0].focus();
        focusables[0].scrollIntoView({ behavior: "instant", block: "nearest" });
        return;
    }

    // Simple: down/right = next, up/left = previous
    let nextIndex: number;
    if (direction === "down" || direction === "right") {
        nextIndex = currentIndex + 1;
        if (nextIndex >= focusables.length) {
            nextIndex = 0; // Wrap to start
        }
    } else {
        nextIndex = currentIndex - 1;
        if (nextIndex < 0) {
            nextIndex = focusables.length - 1; // Wrap to end
        }
    }

    const nextElement = focusables[nextIndex];
    nextElement.focus();
    // Instant scroll for snappy console-like feel
    nextElement.scrollIntoView({ behavior: "instant", block: "nearest" });
}

/**
 * Get focusable buttons and links only (not inputs in controller mode).
 * Sorted by DOM order for predictable navigation.
 */
function getFocusableElements(): HTMLElement[] {
    // Only focus on buttons and links - skip inputs for cleaner controller navigation
    const selector = [
        "button:not([disabled])",
        "a[href]",
        "[role='button']:not([disabled])",
        "[data-focusable]",
    ].join(", ");

    return Array.from(document.querySelectorAll<HTMLElement>(selector))
        .filter((el) => {
            // Filter out hidden elements
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return (
                style.display !== "none" &&
                style.visibility !== "hidden" &&
                style.pointerEvents !== "none" &&
                el.offsetParent !== null &&
                rect.width > 0 &&
                rect.height > 0 &&
                !el.closest("[aria-hidden='true']")
            );
        });
    // Note: Using DOM order (natural tab order) - no sorting needed
}


