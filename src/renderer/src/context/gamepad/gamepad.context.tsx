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
import { logger } from "@renderer/logger";

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
      logger.debug(
        "[Gamepad] Button pressed:",
        GamepadButton[button] || button
      );

      // Any button press activates controller mode
      if (!isControllerMode) {
        logger.info("[Gamepad] Activating controller mode");
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
      } else if (button === mapping.prevSection) {
        navigateSection("prev");
      } else if (button === mapping.nextSection) {
        navigateSection("next");
      }

      // Global shortcuts
      // Y button -> Search
      if (button === GamepadButton.Y) {
        window.dispatchEvent(new CustomEvent("hydra:focus-search"));
        return;
      }

      // Blocking navigation if Virtual Keyboard is open or Search Dropdown is visible
      if (
        document.querySelector(".virtual-keyboard-overlay") ||
        document.querySelector(".search-dropdown")
      ) {
        return;
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

      // Blocking navigation if Virtual Keyboard is open
      if (document.querySelector(".virtual-keyboard-overlay")) {
        return;
      }

      navigateDirection(direction);
    },
    [isControllerMode]
  );

  const handleAxisMove = useCallback(
    (axis: "leftStick" | "rightStick", value: { x: number; y: number }) => {
      if (axis === "rightStick") {
        // Scroll the main content container
        const scrollable = document.querySelector(
          ".container__content"
        ) as HTMLElement;

        if (scrollable) {
          // Multiplier determines scroll speed
          const SCROLL_SPEED = 15;
          scrollable.scrollBy({
            top: value.y * SCROLL_SPEED,
            behavior: "auto", // 'auto' is smoother for continuous input than 'smooth'
          });
        }
      }
    },
    []
  );

  const { gamepads, activeGamepad, subscribe } = useGamepad({
    enabled: true,
    onButtonPress: handleButtonPress,
    onNavigate: handleNavigate,
    onAxisMove: handleAxisMove,
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
    if (focusables.length > 0) {
      focusables[0].focus();
      focusables[0].scrollIntoView({ behavior: "instant", block: "nearest" });
    }
    return;
  }

  const currentRect = current.getBoundingClientRect();
  const currentCenter = {
    x: currentRect.left + currentRect.width / 2,
    y: currentRect.top + currentRect.height / 2,
  };

  let bestCandidate: HTMLElement | null = null;
  let minDistance = Infinity;

  // Filter candidates based on direction
  const candidates = focusables.filter((el) => {
    if (el === current) return false;
    const rect = el.getBoundingClientRect();
    const center = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };

    switch (direction) {
      case "up":
        return center.y < currentRect.top; // Strictly above
      case "down":
        return center.y > currentRect.bottom; // Strictly below
      case "left":
        return center.x < currentRect.left; // Strictly left
      case "right":
        return center.x > currentRect.right; // Strictly right
    }
  });

  // Find nearest candidate using Euclidian distance with directional bias
  candidates.forEach((el) => {
    const rect = el.getBoundingClientRect();
    const center = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };

    // Calculate distance
    const dx = center.x - currentCenter.x;
    const dy = center.y - currentCenter.y;

    // Weight the distance calculation to prefer elements aligned in the primary axis
    // e.g. when moving Up/Down, penalize horizontal deviation heavily
    let dist = 0;
    const ORTHOGONAL_PENALTY = 4.0; // Preference strength

    if (direction === "up" || direction === "down") {
      dist = Math.sqrt(dx * dx * ORTHOGONAL_PENALTY + dy * dy);
    } else {
      dist = Math.sqrt(dx * dx + dy * dy * ORTHOGONAL_PENALTY);
    }

    if (dist < minDistance) {
      minDistance = dist;
      bestCandidate = el;
    }
  });

  if (bestCandidate) {
    (bestCandidate as HTMLElement).focus();
    (bestCandidate as HTMLElement).scrollIntoView({
      behavior: "instant",
      block: "nearest",
    });
  }
}

/**
 * Navigate to the next/previous section (Sidebar <-> Content).
 * Remembers the last focused element in each section.
 */
function navigateSection(_direction: "next" | "prev") {
  const current = document.activeElement as HTMLElement;
  const sidebar = document.querySelector(".sidebar") as HTMLElement;
  const content = document.querySelector(".container") as HTMLElement; // Covers header + content

  if (!sidebar || !content) return;

  // Identify current zone
  const isSidebar = sidebar.contains(current);
  const isContent = content.contains(current);

  // Determine target zone
  // Determine target zone
  let targetZone: HTMLElement | null = null;

  if (isSidebar) {
    // Sidebar -> Content
    targetZone = content;
  } else if (isContent) {
    // Content -> Sidebar
    targetZone = sidebar;
  } else {
    // Unknown/Body -> Default to Sidebar
    // This fixes the "sometimes doesn't let me go to sidebar" issue
    // If we are "lost", we reset to Sidebar as the anchor
    targetZone = sidebar;
  }

  // EXTRA SAFETY: If we are trying to go to Content but Content has no focusables, stay in Sidebar
  if (targetZone === content) {
    const contentHasFocusables = content.querySelector(FOCUSABLE_SELECTOR);
    if (!contentHasFocusables) {
      // If content is empty (e.g. loading), focus the sidebar instead
      targetZone = sidebar;
    }
  }

  // Find something to focus in target zone
  if (targetZone) {
    // 1. Try to recover last focused element in this zone
    const lastFocused = getLastFocusedInZone(targetZone);
    if (
      lastFocused &&
      document.body.contains(lastFocused) &&
      targetZone.contains(lastFocused)
    ) {
      lastFocused.focus();
      return;
    }

    // 2. Fallback: Find first focusable in zone
    const focusables = getFocusableElements();
    const firstInZone = focusables.find((el) => targetZone?.contains(el));

    if (firstInZone) {
      firstInZone.focus();
      firstInZone.scrollIntoView({ behavior: "instant", block: "nearest" });
    }
  }
}

// Track last focused element per zone for memory
const zoneMemory = new Map<HTMLElement, HTMLElement>();

// Update memory on focus change
document.addEventListener("focusin", (e) => {
  const target = e.target as HTMLElement;
  const sidebar = document.querySelector(".sidebar") as HTMLElement;
  const content = document.querySelector(".container") as HTMLElement;

  if (sidebar?.contains(target)) zoneMemory.set(sidebar, target);
  if (content?.contains(target)) zoneMemory.set(content, target);
});

function getLastFocusedInZone(zone: HTMLElement) {
  return zoneMemory.get(zone);
}

// Selector for all focusable elements
const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "[tabindex]:not([tabindex='-1'])",
  "[role='button']:not([disabled])",
  "[data-focusable]",
  "input[type='text']", // Allow search inputs
  "input[type='search']",
].join(", ");

/**
 * Helper to find all focusable elements in consistent DOM order
 */
function getFocusableElements(): HTMLElement[] {
  // Check for open modal
  const activeModal = document.querySelector("[data-hydra-dialog]");
  const root = activeModal || document;

  return Array.from(
    root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
  ).filter((el) => {
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
