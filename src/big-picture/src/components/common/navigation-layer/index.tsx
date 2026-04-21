import { FocusLayerContext } from "../../context";
import { NavigationService } from "../../../services";
import { useEffect, useId } from "react";

interface NavigationLayerProps {
  layerId?: string;
  rootRegionId?: string;
  initialFocusId?: string;
  initialFocusRegionId?: string;
  children: React.ReactNode;
}

export function NavigationLayer({
  layerId,
  rootRegionId,
  initialFocusId,
  initialFocusRegionId,
  children,
}: NavigationLayerProps) {
  const generatedId = useId();
  const navigation = NavigationService.getInstance();
  const resolvedLayerId =
    layerId ?? `navigation-layer-${generatedId.replace(/:/g, "")}`;

  useEffect(() => {
    const unregisterLayer = navigation.registerLayer({
      id: resolvedLayerId,
      rootRegionId,
      isPersistent: Boolean(layerId),
    });

    navigation.focusInitialInLayer({
      layerId: resolvedLayerId,
      initialFocusId,
      initialFocusRegionId,
    });

    return () => {
      unregisterLayer();
    };
  }, [
    initialFocusId,
    initialFocusRegionId,
    layerId,
    navigation,
    resolvedLayerId,
    rootRegionId,
  ]);

  return (
    <FocusLayerContext.Provider value={resolvedLayerId}>
      {children}
    </FocusLayerContext.Provider>
  );
}
