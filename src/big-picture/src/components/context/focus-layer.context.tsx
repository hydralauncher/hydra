import { NavigationService, ROOT_NAVIGATION_LAYER_ID } from "../../services";
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

export const FocusLayerContext = createContext<string>(
  ROOT_NAVIGATION_LAYER_ID
);

export function useFocusLayerId() {
  return useContext(FocusLayerContext);
}

export function useFocusLayerTracker() {
  const layerIdRef = useRef<string | null>(null);
  const [layerId, setLayerId] = useState<string | null>(null);
  const handleLayerChange = useCallback((nextLayerId: string | null) => {
    layerIdRef.current = nextLayerId;
    setLayerId(nextLayerId);
  }, []);
  const isActiveLayer = useCallback(
    () =>
      layerIdRef.current !== null &&
      NavigationService.getInstance().getActiveLayerId() === layerIdRef.current,
    []
  );

  return { layerId, handleLayerChange, isActiveLayer };
}

export function FocusLayerReporter({
  onLayerChange,
}: Readonly<{ onLayerChange: (layerId: string | null) => void }>) {
  const layerId = useFocusLayerId();

  useLayoutEffect(() => {
    onLayerChange(layerId);
    return () => onLayerChange(null);
  }, [layerId, onLayerChange]);

  return null;
}
