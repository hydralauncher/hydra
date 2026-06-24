import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useInputModeStore, useNavigationStore } from "../../stores";
import { MAX_OVERLAY_Z_INDEX } from "../../constants";

export function InputModeProvider() {
  return (
    <>
      <InputModeAttributeSync />
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

function InputModeMouseDetector() {
  const setMouseMode = useInputModeStore((state) => state.setMouseMode);

  useEffect(() => {
    const handlePointerActivity = () => {
      if (useInputModeStore.getState().mode !== "gamepad") return;
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
    useNavigationStore.setState({ currentFocusId: null });
  }, [mode]);

  return null;
}

function InputModeOverlay() {
  const mode = useInputModeStore((state) => state.mode);
  const setMouseMode = useInputModeStore((state) => state.setMouseMode);

  const handlePointerActivity = useCallback(() => {
    setMouseMode();
  }, [setMouseMode]);

  if (mode !== "gamepad") return null;

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: MAX_OVERLAY_Z_INDEX,
        cursor: "none",
        pointerEvents: "auto",
      }}
      onMouseMove={handlePointerActivity}
      onMouseDown={handlePointerActivity}
      onPointerDown={handlePointerActivity}
      onPointerMove={handlePointerActivity}
      onContextMenu={(e) => {
        e.preventDefault();
        setMouseMode();
      }}
    />
  );
}
