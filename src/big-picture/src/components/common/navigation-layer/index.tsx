import { NavigationService } from "../../../services";
import { FocusLayerContext } from "../../context";
import { type ReactNode, useEffect, useId } from "react";

interface NavigationLayerProps {
  layerId?: string;
  rootRegionId?: string;
  initialFocusId?: string;
  initialFocusRegionId?: string;
  children: ReactNode;
}

export function NavigationLayer({
  layerId,
  rootRegionId,
  initialFocusId,
  initialFocusRegionId,
  children,
}: Readonly<NavigationLayerProps>) {
  const generatedId = useId();
  const navigation = NavigationService.getInstance();
  const resolvedLayerId =
    layerId ?? `navigation-layer-${generatedId.replaceAll(":", "")}`;

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
