import { useEffect, useLayoutEffect, useRef } from "react";
import { useInputModeStore, useVirtualKeyboardStore } from "../../stores";
import { GamepadService, NavigationService } from "../../services";

export function InputModeProvider() {
  return (
    <>
      <InputModeAttributeSync />
      <InputModeGamepadDetector />
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

function InputModeMouseDetector() {
  const setMouseMode = useInputModeStore((state) => state.setMouseMode);

  useEffect(() => {
    const handlePointerActivity = () => {
      if (useInputModeStore.getState().mode !== "gamepad") return;
      setMouseMode();
    };

    const handleContextMenu = (e: MouseEvent) => {
      if (useInputModeStore.getState().mode !== "gamepad") return;
      e.preventDefault();
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
  }, [setMouseMode]);

  return null;
}

function InputModeMouseFocusTracker() {
  const setLastMouseFocusId = useInputModeStore(
    (state) => state.setLastMouseFocusId
  );

  useEffect(() => {
    const handleMouseOver = (e: MouseEvent) => {
      if (useInputModeStore.getState().mode !== "mouse") return;

      const target = e.target as HTMLElement;
      const focusItem = target.closest("[data-navigation-state]");
      if (!focusItem?.id) return;
      if (focusItem.id === useInputModeStore.getState().lastMouseFocusId)
        return;

      const node = NavigationService.getInstance().getNode(focusItem.id);

      if (node) {
        setLastMouseFocusId(focusItem.id);
      }
    };

    globalThis.window.addEventListener("mouseover", handleMouseOver, {
      capture: true,
    });

    return () => {
      globalThis.window.removeEventListener("mouseover", handleMouseOver, {
        capture: true,
      });
    };
  }, [setLastMouseFocusId]);

  return null;
}

function InputModeCursorSync() {
  const mode = useInputModeStore((state) => state.mode);

  useEffect(() => {
    const styleId = "bp-input-mode-cursor";
    const existing = document.getElementById(styleId);

    if (mode === "gamepad") {
      if (existing) return;
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
        #big-picture[data-bp-input-mode="gamepad"],
        #big-picture[data-bp-input-mode="gamepad"] * {
          cursor: none !important;
        }
      `;
      document.head.appendChild(style);
    } else {
      existing?.remove();
    }

    return () => document.getElementById(styleId)?.remove();
  }, [mode]);

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
