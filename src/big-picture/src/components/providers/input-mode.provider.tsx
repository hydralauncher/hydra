import { useEffect, useLayoutEffect, useRef } from "react";
import { useInputModeStore, useVirtualKeyboardStore } from "../../stores";
import { MAX_OVERLAY_Z_INDEX } from "../../constants";
import { GamepadService, NavigationService } from "../../services";

export function InputModeProvider() {
  return (
    <>
      <InputModeAttributeSync />
      <InputModeGamepadDetector />
      <InputModeMouseDetector />
      <InputModeFocusCleanup />
      <InputModeOverlay />
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
      const overlay = document.getElementById("bp-input-overlay");
      if (overlay) overlay.style.pointerEvents = "none";
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

function InputModeOverlay() {
  const mode = useInputModeStore((state) => state.mode);

  if (mode !== "gamepad") return null;

  return (
    <div
      id="bp-input-overlay"
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: MAX_OVERLAY_Z_INDEX,
        cursor: "none",
        pointerEvents: "auto",
      }}
    />
  );
}
