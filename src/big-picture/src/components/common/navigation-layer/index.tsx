import { NavigationService } from "../../../services";
import { FocusLayerContext } from "../../context";
import { type ReactNode, useId, useLayoutEffect } from "react";

interface NavigationLayerProps {
  layerId?: string;
  rootRegionId?: string;
  initialFocusId?: string;
  initialFocusRegionId?: string;
  restoreFocusOnUnmount?: boolean | (() => boolean);
  children: ReactNode;
}

export function NavigationLayer({
  layerId,
  rootRegionId,
  initialFocusId,
  initialFocusRegionId,
  restoreFocusOnUnmount,
  children,
}: Readonly<NavigationLayerProps>) {
  const generatedId = useId();
  const navigation = NavigationService.getInstance();
  const resolvedLayerId =
    layerId ?? `navigation-layer-${generatedId.replaceAll(":", "")}`;

  useLayoutEffect(() => {
    const unregisterLayer = navigation.registerLayer({
      id: resolvedLayerId,
      rootRegionId,
      isPersistent: Boolean(layerId),
      restoreFocusOnUnmount,
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
    restoreFocusOnUnmount,
    rootRegionId,
  ]);

  return (
    <FocusLayerContext.Provider value={resolvedLayerId}>
      {children}
    </FocusLayerContext.Provider>
  );
}
