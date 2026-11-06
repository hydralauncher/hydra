import { scrollNavigationIntoView } from "../../helpers";
import { useInputModeStore, useNavigationSnapshot } from "../../stores";
import { useEffect, useRef } from "react";

export function NavigationAutoScrollBridge() {
  const { currentFocusId, nodes, regions } = useNavigationSnapshot();
  const inputMode = useInputModeStore((state) => state.mode);
  const previousFocusIdRef = useRef<string | null>(null);
  const lastFocusIdRef = useRef<string | null>(null);
  const scrolledFocusIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!currentFocusId) {
      previousFocusIdRef.current = null;
      lastFocusIdRef.current = null;
      scrolledFocusIdRef.current = null;
      return;
    }

    const focusChanged = lastFocusIdRef.current !== currentFocusId;
    lastFocusIdRef.current = currentFocusId;

    if (inputMode === "mouse") {
      return;
    }

    const focusedNode = nodes.find((node) => node.id === currentFocusId);

    if (!focusedNode?.getElement?.()) {
      return;
    }

    if (!focusChanged && scrolledFocusIdRef.current === currentFocusId) {
      return;
    }

    const animationFrameId = globalThis.requestAnimationFrame(() => {
      scrollNavigationIntoView({
        currentFocusId,
        previousFocusId: previousFocusIdRef.current,
        nodes,
        regions,
      });

      previousFocusIdRef.current = currentFocusId;
      scrolledFocusIdRef.current = currentFocusId;
    });

    return () => {
      globalThis.cancelAnimationFrame(animationFrameId);
    };
  }, [currentFocusId, inputMode, nodes, regions]);

  return null;
}
