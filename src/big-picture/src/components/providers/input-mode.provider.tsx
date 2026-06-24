import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useInputModeStore } from "../../stores";

export function InputModeProvider() {
  return (
    <>
      <InputModeAttributeSync />
      <InputModeMouseDetector />
      <InputModeOverlay />
    </>
  );
}

function InputModeAttributeSync() {
  const mode = useInputModeStore((state) => state.mode);

  useLayoutEffect(() => {
    const root = document.getElementById("big-picture");
    if (!root) return;

    root.setAttribute("data-bp-input-mode", mode);

    return () => {
      root.removeAttribute("data-bp-input-mode");
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

    window.addEventListener("mousemove", handlePointerActivity, {
      capture: true,
    });
    window.addEventListener("mousedown", handlePointerActivity, {
      capture: true,
    });
    window.addEventListener("wheel", handlePointerActivity, {
      capture: true,
      passive: true,
    });

    return () => {
      window.removeEventListener("mousemove", handlePointerActivity, {
        capture: true,
      });
      window.removeEventListener("mousedown", handlePointerActivity, {
        capture: true,
      });
      window.removeEventListener("wheel", handlePointerActivity, {
        capture: true,
      });
    };
  }, [setMouseMode]);

  return null;
}

function InputModeOverlay() {
  const mode = useInputModeStore((state) => state.mode);
  const setMouseMode = useInputModeStore((state) => state.setMouseMode);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  const handlePointerActivity = useCallback(() => {
    setMouseMode();
  }, [setMouseMode]);

  if (mode !== "gamepad") return null;

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      ref={overlayRef}
      role="none"
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483647,
        cursor: "none",
        pointerEvents: "auto",
      }}
      onMouseMove={handlePointerActivity}
      onMouseDown={handlePointerActivity}
      onPointerDown={handlePointerActivity}
      onPointerMove={handlePointerActivity}
      onWheel={handlePointerActivity}
      onContextMenu={(e) => {
        e.preventDefault();
        setMouseMode();
      }}
    />
  );
}
