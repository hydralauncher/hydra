import { autoUpdate, computePosition } from "@floating-ui/dom";
import type {
  AutoUpdateOptions,
  Middleware,
  Placement,
  Strategy,
} from "@floating-ui/dom";
import { useCallback, useLayoutEffect, useRef } from "react";

type FloatingReference = Parameters<typeof computePosition>[0];

const DEFAULT_AUTO_UPDATE_OPTIONS: AutoUpdateOptions = {
  ancestorScroll: true,
  ancestorResize: true,
  animationFrame: true,
  elementResize: true,
  layoutShift: true,
};

export interface UseFloatingPanelPositionOptions {
  isOpen: boolean;
  reference: FloatingReference | null;
  middleware: Middleware[];
  placement?: Placement;
  strategy?: Strategy;
  autoUpdateOptions?: AutoUpdateOptions;
  zIndex?: number;
}

export function useFloatingPanelPosition<
  TElement extends HTMLElement = HTMLElement,
>({
  isOpen,
  reference,
  middleware,
  placement = "bottom",
  strategy = "fixed",
  autoUpdateOptions,
  zIndex = 1000,
}: Readonly<UseFloatingPanelPositionOptions>) {
  const floatingRef = useRef<TElement | null>(null);

  const updateFloatingPosition = useCallback(() => {
    const floating = floatingRef.current;

    if (!reference || !floating) {
      return;
    }

    void computePosition(reference, floating, {
      placement,
      strategy,
      middleware,
    }).then(({ x, y, strategy: resolvedStrategy }) => {
      const floatingElement = floatingRef.current;

      if (!floatingElement?.isConnected) {
        return;
      }

      Object.assign(floatingElement.style, {
        position: resolvedStrategy ?? strategy,
        left: `${x}px`,
        top: `${y}px`,
        right: "",
        bottom: "",
        zIndex: String(zIndex),
        visibility: "visible",
      });
    });
  }, [middleware, placement, reference, strategy, zIndex]);

  useLayoutEffect(() => {
    if (!isOpen || !reference) {
      return undefined;
    }

    const floating = floatingRef.current;

    if (!floating) {
      return undefined;
    }

    floating.style.visibility = "hidden";

    updateFloatingPosition();

    return autoUpdate(reference, floating, updateFloatingPosition, {
      ...DEFAULT_AUTO_UPDATE_OPTIONS,
      ...autoUpdateOptions,
    });
  }, [autoUpdateOptions, isOpen, reference, updateFloatingPosition]);

  return {
    floatingRef,
    updateFloatingPosition,
  };
}
