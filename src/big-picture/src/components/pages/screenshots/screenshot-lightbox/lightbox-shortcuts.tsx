import { useCallback, useLayoutEffect, useRef, useState } from "react";

import { useFocusLayerId } from "../../../context";
import { useIsLayerOnTop, useNavigationScreenActions } from "../../../../hooks";
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
