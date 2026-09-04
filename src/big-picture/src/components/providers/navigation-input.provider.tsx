import { useGamepad, useNavigationActions } from "../../hooks";
import {
  GamepadService,
  NavigationAudioService,
  NavigationService,
} from "../../services";
import {
  GAMEPAD_REPEAT_INITIAL_DELAY,
  getGamepadRepeatInterval,
} from "../../helpers/gamepad-repeat";
import {
  useNavigationHistoryStore,
  useNavigationStore,
  useInputModeStore,
} from "../../stores";
import { GamepadAxisDirection, GamepadButtonType } from "../../types";
import {
  BIG_PICTURE_CONTENT_REGION_ID,
  getBigPictureContentEntryRegionIdFromPathname,
} from "../../layout/navigation";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";

interface NavigationInputProviderProps {
  children: ReactNode;
}

type NavigationKeyDirection = "up" | "down" | "left" | "right";

const resolveKeyboardDirection = (
  event: KeyboardEvent
): NavigationKeyDirection | null => {
  const key = event.key.toLowerCase();

  if (event.key === "ArrowUp" || key === "w") return "up";
  if (event.key === "ArrowDown" || key === "s") return "down";
  if (event.key === "ArrowLeft" || key === "a") return "left";
  if (event.key === "ArrowRight" || key === "d") return "right";

  return null;
};

type HoldManagedButton = "a" | "b" | "x" | "y" | "start" | "select";
type HoldSession = {
  isPressed: boolean;
  holdTriggered: boolean;
  pressDispatched: boolean;
  timerId: number | null;
  releaseTimerId: number | null;
};

// Y has no hold action anywhere in Big Picture, so its action can fire as soon
// as the button goes down instead of waiting for the release.
const PRESS_ON_DOWN_BUTTONS = new Set<HoldManagedButton>(["y"]);

const HOLD_THRESHOLD_MS = 400;

function createInitialHoldSessions(): Record<HoldManagedButton, HoldSession> {
  return {
    a: {
      isPressed: false,
      holdTriggered: false,
      pressDispatched: false,
      timerId: null,
      releaseTimerId: null,
    },
    b: {
      isPressed: false,
      holdTriggered: false,
      pressDispatched: false,
      timerId: null,
      releaseTimerId: null,
    },
    x: {
      isPressed: false,
      holdTriggered: false,
      pressDispatched: false,
      timerId: null,
      releaseTimerId: null,
    },
    y: {
      isPressed: false,
      holdTriggered: false,
      pressDispatched: false,
      timerId: null,
      releaseTimerId: null,
    },
    start: {
      isPressed: false,
      holdTriggered: false,
      pressDispatched: false,
      timerId: null,
      releaseTimerId: null,
    },
    select: {
      isPressed: false,
      holdTriggered: false,
      pressDispatched: false,
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
  const { pathname } = useLocation();
  const {
    moveFocus,
    setFocusRegion,
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
  const recoverGamepadFocusOrFallback = useCallback(() => {
    useInputModeStore.getState().setGamepadMode();

    if (useInputModeStore.getState().pendingGamepadFocus) {
      useInputModeStore.getState().clearPendingGamepadFocus();
      return true;
    }

    if (NavigationService.getInstance().getCurrentFocusId()) {
      return false;
    }

    const contentRegionId =
      getBigPictureContentEntryRegionIdFromPathname(pathname) ??
      BIG_PICTURE_CONTENT_REGION_ID;

    return Boolean(
      setFocusRegion(contentRegionId, "right", {
        preferRememberedFocus: false,
      })
    );
  }, [pathname, setFocusRegion]);

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
    let heldDirection: NavigationKeyDirection | null = null;
    let repeatTimer: number | null = null;

    const stopRepeat = () => {
      if (repeatTimer !== null) globalThis.window.clearTimeout(repeatTimer);
      repeatTimer = null;
      heldDirection = null;
    };

    const runDirection = (
      direction: NavigationKeyDirection,
      originalEvent: KeyboardEvent | null
    ) => {
      if (recoverGamepadFocusOrFallback()) return;
      if (!triggerScreenDirection(direction, originalEvent)) {
        moveFocus(direction);
      }
    };

    const scheduleRepeat = (
      direction: NavigationKeyDirection,
      delay: number
    ) => {
      repeatTimer = globalThis.window.setTimeout(() => {
        if (heldDirection !== direction) return;

        if (
          !isInputActive ||
          isSystemSwitcherActiveRef.current ||
          isEditableElement(document.activeElement)
        ) {
          stopRepeat();
          return;
        }

        runDirection(direction, null);
        scheduleRepeat(direction, getGamepadRepeatInterval());
      }, delay);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isInputActive || isSystemSwitcherActiveRef.current) {
        return;
      }

      if (shouldIgnoreKeyboardNavigation(event)) {
        return;
      }

      const key = event.key.toLowerCase();
      const direction = resolveKeyboardDirection(event);

      if (direction) {
        event.preventDefault();

        if (event.repeat || heldDirection === direction) return;

        stopRepeat();
        heldDirection = direction;
        runDirection(direction, event);
        scheduleRepeat(direction, GAMEPAD_REPEAT_INITIAL_DELAY);
        return;
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

    const handleKeyUp = (event: KeyboardEvent) => {
      const direction = resolveKeyboardDirection(event);
      if (direction && heldDirection === direction) stopRepeat();
    };

    globalThis.addEventListener("keydown", handleKeyDown);
    globalThis.addEventListener("keyup", handleKeyUp);
    globalThis.addEventListener("blur", stopRepeat);

    return () => {
      globalThis.removeEventListener("keydown", handleKeyDown);
      globalThis.removeEventListener("keyup", handleKeyUp);
      globalThis.removeEventListener("blur", stopRepeat);
      stopRepeat();
    };
  }, [
    isInputActive,
    moveFocus,
    recoverGamepadFocusOrFallback,
    triggerBackAction,
    triggerPrimary,
    triggerScreenDirection,
    triggerScreenPress,
  ]);

  useEffect(() => {
    const unsubDpadUp = onButtonPressed(GamepadButtonType.DPAD_UP, (event) => {
      if (!isInputActive || isSystemSwitcherActiveRef.current) return;
      if (!isActiveGamepadEvent(event)) return;
      if (recoverGamepadFocusOrFallback()) return;

      if (!triggerScreenDirection("up")) {
        moveFocus("up");
      }
    });

    const unsubDpadLeft = onButtonPressed(
      GamepadButtonType.DPAD_LEFT,
      (event) => {
        if (!isInputActive || isSystemSwitcherActiveRef.current) return;
        if (!isActiveGamepadEvent(event)) return;
        if (recoverGamepadFocusOrFallback()) return;

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
        if (recoverGamepadFocusOrFallback()) return;

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
        if (recoverGamepadFocusOrFallback()) return;

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
        if (recoverGamepadFocusOrFallback()) return;

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
        if (recoverGamepadFocusOrFallback()) return;

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
        if (recoverGamepadFocusOrFallback()) return;

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
        if (recoverGamepadFocusOrFallback()) return;

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
    recoverGamepadFocusOrFallback,
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

    const anyButtonPressed = Object.values(buttonStates).some(Boolean);
    if (anyButtonPressed) {
      if (recoverGamepadFocusOrFallback()) {
        return;
      }
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
        session.pressDispatched = false;
        if (session.releaseTimerId !== null) {
          globalThis.window.clearTimeout(session.releaseTimerId);
          session.releaseTimerId = null;
        }

        if (PRESS_ON_DOWN_BUTTONS.has(button)) {
          dispatchPress(button);
          session.pressDispatched = true;
          return;
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

          if (!session.holdTriggered && !session.pressDispatched) {
            dispatchPress(button);
          }

          session.isPressed = false;
          session.holdTriggered = false;
          session.pressDispatched = false;
          session.timerId = null;
          session.releaseTimerId = null;
        };

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
    resetHoldSessions,
    recoverGamepadFocusOrFallback,
    triggerBackAction,
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
