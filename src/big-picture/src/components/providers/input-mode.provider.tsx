import { useEffect, useLayoutEffect, useRef } from "react";
import { useInputModeStore } from "../../stores/input-mode.store";
import { useNavigationStore } from "../../stores/navigation.store";
import { useVirtualKeyboardStore } from "../../stores/virtual-keyboard.store";
import { GamepadService } from "../../services/gamepad.service";
import { NavigationService } from "../../services/navigation.service";
import {
  getMouseFocusTargetId,
  shouldEnterMouseMode,
} from "./input-mode.provider.helpers";

export function InputModeProvider() {
  return (
    <>
      <InputModeAttributeSync />
      <InputModeGamepadDetector />
      <InputModeGamepadFocusTracker />
      <InputModeMouseDetector />
      <InputModeMouseFocusTracker />
      <InputModeCursorSync />
      <InputModeFocusCleanup />
    </>
  );
}

function InputModeAttributeSync() {
  const mode = useInputModeStore((state) => state.mode);

  useLayoutEffect(() => {
    const root = document.getElementById("big-picture");
    if (!root) return;

    root.dataset.bpInputMode = mode;

    return () => {
      delete root.dataset.bpInputMode;
    };
  }, [mode]);

  return null;
}

function InputModeGamepadDetector() {
  useEffect(() => {
    return GamepadService.getInstance().onAnyButtonPress(() => {
      useInputModeStore.getState().setGamepadMode();
    });
  }, []);

  return null;
}

function InputModeGamepadFocusTracker() {
  const mode = useInputModeStore((state) => state.mode);
  const currentFocusId = useNavigationStore((state) => state.currentFocusId);
  const setGamepadFocusSnapshot = useInputModeStore(
    (state) => state.setGamepadFocusSnapshot
  );

  useEffect(() => {
    if (mode !== "gamepad") return;
    if (!currentFocusId) return;
    if (!NavigationService.getInstance().getNode(currentFocusId)) return;

    setGamepadFocusSnapshot(currentFocusId);
  }, [currentFocusId, mode, setGamepadFocusSnapshot]);

  return null;
}

function InputModeMouseDetector() {
  const setMouseMode = useInputModeStore((state) => state.setMouseMode);
  const setMouseFocusSnapshot = useInputModeStore(
    (state) => state.setMouseFocusSnapshot
  );

  useEffect(() => {
    const handlePointerActivity = (event: MouseEvent | WheelEvent) => {
      if (
        !shouldEnterMouseMode(
          useInputModeStore.getState().mode,
          GamepadService.getInstance().wasGamepadRecentlyActive()
        )
      ) {
        return;
      }

      setMouseFocusSnapshot(getMouseFocusTargetId(event.target));
      setMouseMode();
    };

    const handleContextMenu = (e: MouseEvent) => {
      if (
        !shouldEnterMouseMode(
          useInputModeStore.getState().mode,
          GamepadService.getInstance().wasGamepadRecentlyActive()
        )
      ) {
        return;
      }
      e.preventDefault();
      setMouseFocusSnapshot(getMouseFocusTargetId(e.target));
      setMouseMode();
    };

    globalThis.window.addEventListener("mousemove", handlePointerActivity, {
      capture: true,
    });
    globalThis.window.addEventListener("mousedown", handlePointerActivity, {
      capture: true,
    });
    globalThis.window.addEventListener("wheel", handlePointerActivity, {
      capture: true,
      passive: true,
    });
    globalThis.window.addEventListener("contextmenu", handleContextMenu, {
      capture: true,
    });

    return () => {
      globalThis.window.removeEventListener(
        "mousemove",
        handlePointerActivity,
        {
          capture: true,
        }
      );
      globalThis.window.removeEventListener(
        "mousedown",
        handlePointerActivity,
        {
          capture: true,
        }
      );
      globalThis.window.removeEventListener("wheel", handlePointerActivity, {
        capture: true,
      });
      globalThis.window.removeEventListener("contextmenu", handleContextMenu, {
        capture: true,
      });
    };
  }, [setMouseFocusSnapshot, setMouseMode]);

  return null;
}

function InputModeMouseFocusTracker() {
  const setMouseFocusSnapshot = useInputModeStore(
    (state) => state.setMouseFocusSnapshot
  );

  useEffect(() => {
    const handleMouseOver = (e: MouseEvent) => {
      if (useInputModeStore.getState().mode !== "mouse") return;

      const focusId = getMouseFocusTargetId(e.target);
      const currentSnapshot = useInputModeStore.getState().mouseFocusSnapshot;

      if (focusId === currentSnapshot?.focusId) return;

      if (focusId && NavigationService.getInstance().getNode(focusId)) {
        setMouseFocusSnapshot(focusId);
        return;
      }

      setMouseFocusSnapshot(null);
    };

    globalThis.window.addEventListener("mouseover", handleMouseOver, {
      capture: true,
    });

    return () => {
      globalThis.window.removeEventListener("mouseover", handleMouseOver, {
        capture: true,
      });
    };
  }, [setMouseFocusSnapshot]);

  return null;
}

function InputModeCursorSync() {
  useEffect(() => {
    return () =>
      document.getElementById("bp-input-mode-gamepad-style")?.remove();
  }, []);

  return null;
}

function InputModeFocusCleanup() {
  const mode = useInputModeStore((state) => state.mode);
  const prevModeRef = useRef(mode);

  useLayoutEffect(() => {
    const prevMode = prevModeRef.current;
    prevModeRef.current = mode;

    if (prevMode !== "gamepad" || mode !== "mouse") return;

    (document.activeElement as HTMLElement)?.blur();
    NavigationService.getInstance().clearFocus();
    useVirtualKeyboardStore.setState({ target: null });
    useVirtualKeyboardStore.getState().closeKeyboard?.({ restoreFocus: false });
  }, [mode]);

  return null;
}
