import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

import { useFocusLayerId } from "../../../context";
import { useGamepad, useNavigationScreenActions } from "../../../../hooks";
import { GamepadButtonType } from "../../../../types";
import { NavigationService } from "../../../../services";

const navigationService = NavigationService.getInstance();

export function useActiveLayerTracker() {
  const layerIdRef = useRef<string | null>(null);
  const handleLayerChange = useCallback((layerId: string | null) => {
    layerIdRef.current = layerId;
  }, []);
  const isActiveLayer = useCallback(
    () =>
      layerIdRef.current !== null &&
      navigationService.getActiveLayerId() === layerIdRef.current,
    []
  );

  return { handleLayerChange, isActiveLayer };
}

interface LightboxLayerReporterProps {
  onLayerChange: (layerId: string | null) => void;
}

export function LightboxLayerReporter({
  onLayerChange,
}: Readonly<LightboxLayerReporterProps>) {
  const layerId = useFocusLayerId();

  useLayoutEffect(() => {
    onLayerChange(layerId);
    return () => onLayerChange(null);
  }, [layerId, onLayerChange]);

  return null;
}

export interface LightboxShortcutsOptions {
  isOpen: boolean;
  canUseShortcuts: boolean;
  hasLocalOverlay: boolean;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
  isActiveLayer: () => boolean;
}

const isTypingInField = () => {
  const activeElement = globalThis.document.activeElement;

  return (
    activeElement instanceof HTMLInputElement ||
    activeElement instanceof HTMLTextAreaElement ||
    (activeElement instanceof HTMLElement && activeElement.isContentEditable)
  );
};

export function useLightboxShortcuts({
  isOpen,
  canUseShortcuts,
  hasLocalOverlay,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
  onClose,
  isActiveLayer,
}: LightboxShortcutsOptions) {
  const { onButtonPressed, isActiveGamepadEvent } = useGamepad();
  const canGoPrevious = canUseShortcuts && hasPrevious;
  const canGoNext = canUseShortcuts && hasNext;

  useNavigationScreenActions(
    isOpen && !hasLocalOverlay
      ? {
          press: {
            b: () => {
              if (isActiveLayer()) onClose();
            },
          },
        }
      : {}
  );

  useEffect(() => {
    const removeLeft = onButtonPressed(
      GamepadButtonType.LEFT_BUMPER,
      (event) => {
        if (canGoPrevious && isActiveGamepadEvent(event) && isActiveLayer())
          onPrevious();
      }
    );
    const removeRight = onButtonPressed(
      GamepadButtonType.RIGHT_BUMPER,
      (event) => {
        if (canGoNext && isActiveGamepadEvent(event) && isActiveLayer())
          onNext();
      }
    );

    return () => {
      removeLeft();
      removeRight();
    };
  }, [
    canGoNext,
    canGoPrevious,
    isActiveGamepadEvent,
    isActiveLayer,
    onButtonPressed,
    onNext,
    onPrevious,
  ]);

  useEffect(() => {
    if (!isOpen || hasLocalOverlay) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTypingInField() || !isActiveLayer())
        return;

      if (event.key === "Escape") onClose();
      if (event.key === "PageUp" && hasPrevious) onPrevious();
      if (event.key === "PageDown" && hasNext) onNext();
    };

    globalThis.window.addEventListener("keydown", onKeyDown);
    return () => globalThis.window.removeEventListener("keydown", onKeyDown);
  }, [
    hasLocalOverlay,
    hasNext,
    hasPrevious,
    isActiveLayer,
    isOpen,
    onClose,
    onNext,
    onPrevious,
  ]);
}
