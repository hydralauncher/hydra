import { useGamepad, useNavigationActions } from "../../hooks";
import { useNavigationStore } from "../../stores";
import { GamepadAxisDirection, GamepadButtonType } from "../../types";
import { type ReactNode, useCallback, useEffect, useRef } from "react";

interface NavigationInputProviderProps {
  children: ReactNode;
}

type HoldManagedButton = "a" | "b" | "x" | "y" | "start" | "select";
type HoldSession = {
  isPressed: boolean;
  holdTriggered: boolean;
  timerId: number | null;
};

const HOLD_THRESHOLD_MS = 400;

function createInitialHoldSessions(): Record<HoldManagedButton, HoldSession> {
  return {
    a: {
      isPressed: false,
      holdTriggered: false,
      timerId: null,
    },
    b: {
      isPressed: false,
      holdTriggered: false,
      timerId: null,
    },
    x: {
      isPressed: false,
      holdTriggered: false,
      timerId: null,
    },
    y: {
      isPressed: false,
      holdTriggered: false,
      timerId: null,
    },
    start: {
      isPressed: false,
      holdTriggered: false,
      timerId: null,
    },
    select: {
      isPressed: false,
      holdTriggered: false,
      timerId: null,
    },
  };
}

function isEditableElement(element: EventTarget | null) {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const tagName = element.tagName.toLowerCase();

  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    element.isContentEditable
  );
}

function shouldIgnoreKeyboardNavigation(event: KeyboardEvent) {
  return (
    isEditableElement(event.target) || isEditableElement(document.activeElement)
  );
}

export function NavigationInputProvider({
  children,
}: Readonly<NavigationInputProviderProps>) {
  const {
    moveFocus,
    triggerPrimary,
    triggerSecondary,
    triggerItemPress,
    triggerItemHold,
    triggerScreenPress,
    triggerScreenHold,
    canResolveFocusedPrimaryAction,
    canResolveFocusedSecondaryAction,
    hasFocusedItemPressAction,
    hasFocusedItemHoldAction,
    hasScreenPressAction,
    hasScreenHoldAction,
  } = useNavigationActions();
  const {
    onButtonPressed,
    onStickMove,
    isButtonPressed,
    isActiveGamepadEvent,
    activeGamepadIndex,
  } = useGamepad();
  const currentFocusId = useNavigationStore((state) => state.currentFocusId);
  const holdSessionsRef = useRef(createInitialHoldSessions());
  const warnedConflictsRef = useRef(new Set<string>());

  const warnActionConflict = useCallback(
    (
      mode: "press" | "hold",
      button: HoldManagedButton | "a" | "b" | "x" | "y"
    ) => {
      if (process.env.NODE_ENV === "production" || !currentFocusId) {
        return;
      }

      const warningKey = `${currentFocusId}:${mode}:${button}`;

      if (warnedConflictsRef.current.has(warningKey)) {
        return;
      }

      console.warn(
        `Navigation input conflict detected for ${mode}.${button}. The focused item "${currentFocusId}" and an active screen action both handle this input. The focused item will take priority. Remove one handler or move the screen action to a narrower scope to avoid ambiguous behavior.`
      );
      warnedConflictsRef.current.add(warningKey);
    },
    [currentFocusId]
  );

  const resetHoldSessions = useCallback(() => {
    const holdSessions = holdSessionsRef.current;

    (Object.keys(holdSessions) as HoldManagedButton[]).forEach((button) => {
      const session = holdSessions[button];

      if (session.timerId !== null) {
        globalThis.window.clearTimeout(session.timerId);
      }

      session.isPressed = false;
      session.holdTriggered = false;
      session.timerId = null;
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreKeyboardNavigation(event)) {
        return;
      }

      const key = event.key.toLowerCase();

      if (event.key === "ArrowUp" || key === "w") {
        event.preventDefault();
        moveFocus("up");
      }

      if (event.key === "ArrowLeft" || key === "a") {
        event.preventDefault();
        moveFocus("left");
      }

      if (event.key === "ArrowDown" || key === "s") {
        event.preventDefault();
        moveFocus("down");
      }

      if (event.key === "ArrowRight" || key === "d") {
        event.preventDefault();
        moveFocus("right");
      }

      const isPrimaryKey =
        event.key === "Enter" || event.key === " " || key === "spacebar";

      if (isPrimaryKey && !event.repeat) {
        event.preventDefault();
        if (!triggerPrimary(event)) {
          triggerScreenPress("a", event);
        }
      }

      if (event.key === "Escape" && !event.repeat) {
        event.preventDefault();
        triggerScreenPress("b", event);
      }
    };

    globalThis.addEventListener("keydown", handleKeyDown);

    return () => {
      globalThis.removeEventListener("keydown", handleKeyDown);
    };
  }, [moveFocus, triggerPrimary, triggerScreenPress]);

  useEffect(() => {
    const unsubDpadUp = onButtonPressed(GamepadButtonType.DPAD_UP, (event) => {
      if (!isActiveGamepadEvent(event)) return;

      moveFocus("up");
    });

    const unsubDpadLeft = onButtonPressed(
      GamepadButtonType.DPAD_LEFT,
      (event) => {
        if (!isActiveGamepadEvent(event)) return;

        moveFocus("left");
      }
    );

    const unsubDpadDown = onButtonPressed(
      GamepadButtonType.DPAD_DOWN,
      (event) => {
        if (!isActiveGamepadEvent(event)) return;

        moveFocus("down");
      }
    );

    const unsubDpadRight = onButtonPressed(
      GamepadButtonType.DPAD_RIGHT,
      (event) => {
        if (!isActiveGamepadEvent(event)) return;

        moveFocus("right");
      }
    );

    const unsubStickUp = onStickMove(
      "left",
      GamepadAxisDirection.UP,
      (event) => {
        if (!isActiveGamepadEvent(event)) return;

        moveFocus("up");
      }
    );

    const unsubStickLeft = onStickMove(
      "left",
      GamepadAxisDirection.LEFT,
      (event) => {
        if (!isActiveGamepadEvent(event)) return;

        moveFocus("left");
      }
    );

    const unsubStickDown = onStickMove(
      "left",
      GamepadAxisDirection.DOWN,
      (event) => {
        if (!isActiveGamepadEvent(event)) return;

        moveFocus("down");
      }
    );

    const unsubStickRight = onStickMove(
      "left",
      GamepadAxisDirection.RIGHT,
      (event) => {
        if (!isActiveGamepadEvent(event)) return;

        moveFocus("right");
      }
    );

    return () => {
      unsubDpadUp();
      unsubDpadDown();
      unsubDpadLeft();
      unsubDpadRight();
      unsubStickUp();
      unsubStickDown();
      unsubStickLeft();
      unsubStickRight();
    };
  }, [isActiveGamepadEvent, moveFocus, onButtonPressed, onStickMove]);

  useEffect(() => {
    resetHoldSessions();
  }, [activeGamepadIndex, resetHoldSessions]);

  const isAPressed = isButtonPressed(GamepadButtonType.BUTTON_A);
  const isBPressed = isButtonPressed(GamepadButtonType.BUTTON_B);
  const isXPressed = isButtonPressed(GamepadButtonType.BUTTON_X);
  const isYPressed = isButtonPressed(GamepadButtonType.BUTTON_Y);
  const isStartPressed = isButtonPressed(GamepadButtonType.START);
  const isSelectPressed = isButtonPressed(GamepadButtonType.BACK);

  useEffect(() => {
    const holdSessions = holdSessionsRef.current;
    const buttonStates: Record<HoldManagedButton, boolean> = {
      a: isAPressed,
      b: isBPressed,
      x: isXPressed,
      y: isYPressed,
      start: isStartPressed,
      select: isSelectPressed,
    };

    const dispatchHold = (button: HoldManagedButton) => {
      if (button === "y") {
        if (canResolveFocusedSecondaryAction() && hasScreenHoldAction("y")) {
          warnActionConflict("hold", "y");
        }

        return triggerSecondary() || triggerScreenHold("y");
      }

      if (button === "start" || button === "select") {
        return triggerScreenHold(button);
      }

      if (hasFocusedItemHoldAction(button) && hasScreenHoldAction(button)) {
        warnActionConflict("hold", button);
      }

      return triggerItemHold(button) || triggerScreenHold(button);
    };

    const dispatchPress = (button: HoldManagedButton) => {
      if (button === "a") {
        if (canResolveFocusedPrimaryAction() && hasScreenPressAction("a")) {
          warnActionConflict("press", "a");
        }

        return triggerPrimary() || triggerScreenPress("a");
      }

      if (button === "b") {
        return triggerScreenPress("b");
      }

      if (button === "x" || button === "y") {
        if (hasFocusedItemPressAction(button) && hasScreenPressAction(button)) {
          warnActionConflict("press", button);
        }

        return triggerItemPress(button) || triggerScreenPress(button);
      }

      if (button === "start" || button === "select") {
        return triggerScreenPress(button);
      }

      return false;
    };

    (Object.keys(buttonStates) as HoldManagedButton[]).forEach((button) => {
      const isPressed = buttonStates[button];
      const session = holdSessions[button];

      if (isPressed && !session.isPressed) {
        session.isPressed = true;
        session.holdTriggered = false;
        session.timerId = globalThis.window.setTimeout(() => {
          const wasHandled = dispatchHold(button);

          if (wasHandled) {
            session.holdTriggered = true;
          }

          session.timerId = null;
        }, HOLD_THRESHOLD_MS);

        return;
      }

      if (!isPressed && session.isPressed) {
        if (session.timerId !== null) {
          globalThis.window.clearTimeout(session.timerId);
        }

        if (!session.holdTriggered) {
          dispatchPress(button);
        }

        session.isPressed = false;
        session.holdTriggered = false;
        session.timerId = null;
      }
    });
  }, [
    isAPressed,
    isBPressed,
    isXPressed,
    isYPressed,
    isStartPressed,
    isSelectPressed,
    triggerItemHold,
    triggerItemPress,
    triggerPrimary,
    triggerScreenHold,
    triggerScreenPress,
    triggerSecondary,
    canResolveFocusedPrimaryAction,
    canResolveFocusedSecondaryAction,
    hasFocusedItemPressAction,
    hasFocusedItemHoldAction,
    hasScreenPressAction,
    hasScreenHoldAction,
    warnActionConflict,
  ]);

  useEffect(() => {
    resetHoldSessions();
  }, [currentFocusId, resetHoldSessions]);

  useEffect(() => {
    warnedConflictsRef.current.clear();
  }, [currentFocusId]);

  useEffect(() => {
    return () => {
      resetHoldSessions();
    };
  }, [resetHoldSessions]);

  return children;
}
