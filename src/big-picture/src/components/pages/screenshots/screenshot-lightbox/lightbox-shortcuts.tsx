import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { useFocusLayerId } from "../../../context";
import {
  useGamepad,
  useIsLayerOnTop,
  useNavigationScreenActions,
} from "../../../../hooks";
import { GamepadButtonType } from "../../../../types";
import { NavigationService } from "../../../../services";

const navigationService = NavigationService.getInstance();

interface LightboxBackActionProps {
  enabled: boolean;
  layerId: string | null;
  isActiveLayer: () => boolean;
  onClose: () => void;
}

export function LightboxBackAction({
  enabled,
  layerId,
  isActiveLayer,
  onClose,
}: Readonly<LightboxBackActionProps>) {
  const isOnTop = useIsLayerOnTop(layerId);
  useNavigationScreenActions(
    enabled && isOnTop
      ? {
          press: {
            b: () => {
              if (isActiveLayer()) onClose();
            },
          },
        }
      : {}
  );

  return null;
}

export function useActiveLayerTracker() {
  const layerIdRef = useRef<string | null>(null);
  const [layerId, setLayerId] = useState<string | null>(null);
  const handleLayerChange = useCallback((nextLayerId: string | null) => {
    layerIdRef.current = nextLayerId;
    setLayerId(nextLayerId);
  }, []);
  const isActiveLayer = useCallback(
    () =>
      layerIdRef.current !== null &&
      navigationService.getActiveLayerId() === layerIdRef.current,
    []
  );

  return { layerId, handleLayerChange, isActiveLayer };
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
