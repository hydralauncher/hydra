import { scrollNavigationIntoView } from "../../helpers";
import { useNavigationSnapshot } from "../../stores";
import { useEffect, useRef } from "react";

export function NavigationAutoScrollBridge() {
  const { currentFocusId, nodes, regions } = useNavigationSnapshot();
  const previousFocusIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!currentFocusId) {
      previousFocusIdRef.current = null;
      return;
    }

    if (currentFocusId === previousFocusIdRef.current) return;

    const animationFrameId = globalThis.requestAnimationFrame(() => {
      const focusedNode = nodes.find((node) => node.id === currentFocusId);
      if (!focusedNode?.getElement?.()) return;

      scrollNavigationIntoView({
        currentFocusId,
        previousFocusId: previousFocusIdRef.current,
        nodes,
        regions,
      });

      previousFocusIdRef.current = currentFocusId;
    });

    return () => {
      globalThis.cancelAnimationFrame(animationFrameId);
    };
  }, [currentFocusId, nodes, regions]);

  return null;
}
