import { useGamepad, useNavigationActions } from "../../hooks";
import { GamepadService, NavigationAudioService } from "../../services";
import { useNavigationHistoryStore, useNavigationStore } from "../../stores";
import { GamepadAxisDirection, GamepadButtonType } from "../../types";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";

interface NavigationInputProviderProps {
  children: ReactNode;
}

type HoldManagedButton = "a" | "b" | "x" | "y" | "start" | "select";
type HoldSession = {
  isPressed: boolean;
  holdTriggered: boolean;
  timerId: number | null;
  releaseTimerId: number | null;
};

const HOLD_THRESHOLD_MS = 400;
const HOLD_RELEASE_GRACE_MS = 80;

function createInitialHoldSessions(): Record<HoldManagedButton, HoldSession> {
  return {
    a: {
      isPressed: false,
      holdTriggered: false,
      timerId: null,
      releaseTimerId: null,
    },
    b: {
      isPressed: false,
      holdTriggered: false,
      timerId: null,
      releaseTimerId: null,
    },
    x: {
      isPressed: false,
      holdTriggered: false,
      timerId: null,
      releaseTimerId: null,
    },
    y: {
      isPressed: false,
      holdTriggered: false,
      timerId: null,
      releaseTimerId: null,
    },
    start: {
      isPressed: false,
      holdTriggered: false,
      timerId: null,
      releaseTimerId: null,
    },
    select: {
      isPressed: false,
      holdTriggered: false,
      timerId: null,
      releaseTimerId: null,
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

function isWindowInputActive() {
  return document.hasFocus() && document.visibilityState === "visible";
}

function isSystemSwitcherModifierEvent(event: KeyboardEvent) {
  return (
    event.key === "Alt" || event.key === "Meta" || event.altKey || event.metaKey
  );
}

export function NavigationInputProvider({
  children,
}: Readonly<NavigationInputProviderProps>) {
  const navigate = useNavigate();
  const {
    moveFocus,
    triggerPrimary,
    triggerItemPress,
    triggerItemHold,
    triggerScreenPress,
    triggerScreenHold,
    triggerScreenDirection,
    canResolveFocusedPrimaryAction,
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
  const ignoredPressedButtonsRef = useRef(new Set<HoldManagedButton>());
  const isSystemSwitcherActiveRef = useRef(false);
  const [isInputActive, setIsInputActive] = useState(isWindowInputActive);

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

      if (session.releaseTimerId !== null) {
        globalThis.window.clearTimeout(session.releaseTimerId);
      }

      session.isPressed = false;
      session.holdTriggered = false;
      session.timerId = null;
      session.releaseTimerId = null;
    });
  }, []);

  const syncInputActivity = useCallback(() => {
    setIsInputActive(
      isWindowInputActive() && !isSystemSwitcherActiveRef.current
    );
  }, []);

  const suspendInputForSystemSwitcher = useCallback(() => {
    isSystemSwitcherActiveRef.current = true;
    GamepadService.getInstance().setInputEnabled(false);
    resetHoldSessions();
    setIsInputActive(false);
  }, [resetHoldSessions]);

  const releaseSystemSwitcherInput = useCallback(() => {
    isSystemSwitcherActiveRef.current = false;
    syncInputActivity();
  }, [syncInputActivity]);

  const triggerBackAction = useCallback(
    (originalEvent: Event | null = null) => {
      if (triggerScreenPress("b", originalEvent)) {
        return true;
      }

      const historyStack = useNavigationHistoryStore.getState().stack;

      if (historyStack.length <= 1) {
        return false;
      }

      NavigationAudioService.getInstance().play("back");
      navigate(-1);
      return true;
    },
    [navigate, triggerScreenPress]
  );

  useEffect(() => {
    syncInputActivity();

    globalThis.window.addEventListener("focus", syncInputActivity);
    globalThis.window.addEventListener("blur", syncInputActivity);
    globalThis.window.addEventListener("pagehide", syncInputActivity);
    document.addEventListener("visibilitychange", syncInputActivity);

    return () => {
      globalThis.window.removeEventListener("focus", syncInputActivity);
      globalThis.window.removeEventListener("blur", syncInputActivity);
      globalThis.window.removeEventListener("pagehide", syncInputActivity);
      document.removeEventListener("visibilitychange", syncInputActivity);
    };
  }, [syncInputActivity]);

  useEffect(() => {
    const handleSystemShortcutKeyDown = (event: KeyboardEvent) => {
      if (isSystemSwitcherModifierEvent(event)) {
        suspendInputForSystemSwitcher();
      }
    };

    const handleSystemShortcutKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Alt" || event.key === "Meta") {
        releaseSystemSwitcherInput();
      }
    };

    const handleSystemShortcutFocus = () => {
      releaseSystemSwitcherInput();
    };

    const handleSystemShortcutVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        releaseSystemSwitcherInput();
      }
    };

    globalThis.window.addEventListener(
      "keydown",
      handleSystemShortcutKeyDown,
      true
    );
    globalThis.window.addEventListener(
      "keyup",
      handleSystemShortcutKeyUp,
      true
    );
    globalThis.window.addEventListener("focus", handleSystemShortcutFocus);
    document.addEventListener(
      "visibilitychange",
      handleSystemShortcutVisibilityChange
    );

    return () => {
      globalThis.window.removeEventListener(
        "keydown",
        handleSystemShortcutKeyDown,
        true
      );
      globalThis.window.removeEventListener(
        "keyup",
        handleSystemShortcutKeyUp,
        true
      );
      globalThis.window.removeEventListener("focus", handleSystemShortcutFocus);
      document.removeEventListener(
        "visibilitychange",
        handleSystemShortcutVisibilityChange
      );
    };
  }, [releaseSystemSwitcherInput, suspendInputForSystemSwitcher]);

  useEffect(() => {
    GamepadService.getInstance().setInputEnabled(isInputActive);

    if (!isInputActive) {
      resetHoldSessions();
    }
  }, [isInputActive, resetHoldSessions]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isInputActive || isSystemSwitcherActiveRef.current) {
        return;
      }

      if (shouldIgnoreKeyboardNavigation(event)) {
        return;
      }

      const key = event.key.toLowerCase();

      if (event.key === "ArrowUp" || key === "w") {
        event.preventDefault();
        if (!triggerScreenDirection("up", event)) {
          moveFocus("up");
        }
      }

      if (event.key === "ArrowLeft" || key === "a") {
        event.preventDefault();
        if (!triggerScreenDirection("left", event)) {
          moveFocus("left");
        }
      }

      if (event.key === "ArrowDown" || key === "s") {
        event.preventDefault();
        if (!triggerScreenDirection("down", event)) {
          moveFocus("down");
        }
      }

      if (event.key === "ArrowRight" || key === "d") {
        event.preventDefault();
        if (!triggerScreenDirection("right", event)) {
          moveFocus("right");
        }
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
        triggerBackAction(event);
      }
    };

    globalThis.addEventListener("keydown", handleKeyDown);

    return () => {
      globalThis.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    isInputActive,
    moveFocus,
    triggerBackAction,
    triggerPrimary,
    triggerScreenDirection,
    triggerScreenPress,
  ]);

  useEffect(() => {
    const unsubDpadUp = onButtonPressed(GamepadButtonType.DPAD_UP, (event) => {
      if (!isInputActive || isSystemSwitcherActiveRef.current) return;
      if (!isActiveGamepadEvent(event)) return;

      if (!triggerScreenDirection("up")) {
        moveFocus("up");
      }
    });

    const unsubDpadLeft = onButtonPressed(
      GamepadButtonType.DPAD_LEFT,
      (event) => {
        if (!isInputActive || isSystemSwitcherActiveRef.current) return;
        if (!isActiveGamepadEvent(event)) return;

        if (!triggerScreenDirection("left")) {
          moveFocus("left");
        }
      }
    );

    const unsubDpadDown = onButtonPressed(
      GamepadButtonType.DPAD_DOWN,
      (event) => {
        if (!isInputActive || isSystemSwitcherActiveRef.current) return;
        if (!isActiveGamepadEvent(event)) return;

        if (!triggerScreenDirection("down")) {
          moveFocus("down");
        }
      }
    );

    const unsubDpadRight = onButtonPressed(
      GamepadButtonType.DPAD_RIGHT,
      (event) => {
        if (!isInputActive || isSystemSwitcherActiveRef.current) return;
        if (!isActiveGamepadEvent(event)) return;

        if (!triggerScreenDirection("right")) {
          moveFocus("right");
        }
      }
    );

    const unsubStickUp = onStickMove(
      "left",
      GamepadAxisDirection.UP,
      (event) => {
        if (!isInputActive || isSystemSwitcherActiveRef.current) return;
        if (!isActiveGamepadEvent(event)) return;

        if (!triggerScreenDirection("up")) {
          moveFocus("up");
        }
      }
    );

    const unsubStickLeft = onStickMove(
      "left",
      GamepadAxisDirection.LEFT,
      (event) => {
        if (!isInputActive || isSystemSwitcherActiveRef.current) return;
        if (!isActiveGamepadEvent(event)) return;

        if (!triggerScreenDirection("left")) {
          moveFocus("left");
        }
      }
    );

    const unsubStickDown = onStickMove(
      "left",
      GamepadAxisDirection.DOWN,
      (event) => {
        if (!isInputActive || isSystemSwitcherActiveRef.current) return;
        if (!isActiveGamepadEvent(event)) return;

        if (!triggerScreenDirection("down")) {
          moveFocus("down");
        }
      }
    );

    const unsubStickRight = onStickMove(
      "left",
      GamepadAxisDirection.RIGHT,
      (event) => {
        if (!isInputActive || isSystemSwitcherActiveRef.current) return;
        if (!isActiveGamepadEvent(event)) return;

        if (!triggerScreenDirection("right")) {
          moveFocus("right");
        }
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
  }, [
    isInputActive,
    isActiveGamepadEvent,
    moveFocus,
    onButtonPressed,
    onStickMove,
    triggerScreenDirection,
  ]);

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
    const buttonStates: Record<HoldManagedButton, boolean> = {
      a: isAPressed,
      b: isBPressed,
      x: isXPressed,
      y: isYPressed,
      start: isStartPressed,
      select: isSelectPressed,
    };

    if (!isInputActive) {
      (Object.keys(buttonStates) as HoldManagedButton[]).forEach((button) => {
        if (buttonStates[button]) {
          ignoredPressedButtonsRef.current.add(button);
        }
      });

      resetHoldSessions();
      return;
    }

    const holdSessions = holdSessionsRef.current;

    const dispatchHold = (button: HoldManagedButton) => {
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
        return triggerBackAction();
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

      if (ignoredPressedButtonsRef.current.has(button)) {
        if (!isPressed) {
          ignoredPressedButtonsRef.current.delete(button);
        }

        return;
      }

      if (isPressed && !session.isPressed) {
        session.isPressed = true;
        session.holdTriggered = false;
        if (session.releaseTimerId !== null) {
          globalThis.window.clearTimeout(session.releaseTimerId);
          session.releaseTimerId = null;
        }
        session.timerId = globalThis.window.setTimeout(() => {
          const wasHandled = dispatchHold(button);

          if (wasHandled) {
            session.holdTriggered = true;
          }

          session.timerId = null;
        }, HOLD_THRESHOLD_MS);

        return;
      }

      if (isPressed && session.releaseTimerId !== null) {
        globalThis.window.clearTimeout(session.releaseTimerId);
        session.releaseTimerId = null;
        return;
      }

      if (!isPressed && session.isPressed) {
        const finalizeRelease = () => {
          if (session.timerId !== null) {
            globalThis.window.clearTimeout(session.timerId);
          }

          if (!session.holdTriggered) {
            dispatchPress(button);
          }

          session.isPressed = false;
          session.holdTriggered = false;
          session.timerId = null;
          session.releaseTimerId = null;
        };

        if (button === "y" && session.releaseTimerId === null) {
          session.releaseTimerId = globalThis.window.setTimeout(() => {
            finalizeRelease();
          }, HOLD_RELEASE_GRACE_MS);

          return;
        }

        finalizeRelease();
      }
    });
  }, [
    isAPressed,
    isBPressed,
    isInputActive,
    isXPressed,
    isYPressed,
    isStartPressed,
    isSelectPressed,
    triggerItemHold,
    triggerItemPress,
    triggerPrimary,
    triggerScreenHold,
    triggerScreenPress,
    canResolveFocusedPrimaryAction,
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
