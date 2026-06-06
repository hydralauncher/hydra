import { NavigationService } from "../../../services";
import { FocusLayerContext } from "../../context";
import {
  type ReactNode,
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
} from "react";

interface NavigationLayerProps {
  layerId?: string;
  rootRegionId?: string;
  initialFocusId?: string;
  initialFocusRegionId?: string;
  children: ReactNode;
}

export const NavigationLayer = forwardRef<void, Readonly<NavigationLayerProps>>(
  (
    { layerId, rootRegionId, initialFocusId, initialFocusRegionId, children },
    forwardedRef
  ) => {
    const generatedId = useId();
    const navigation = NavigationService.getInstance();
    const resolvedLayerId =
      layerId ?? `navigation-layer-${generatedId.replaceAll(":", "")}`;

    useImperativeHandle(forwardedRef, () => ({}) as never);

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
);

NavigationLayer.displayName = "NavigationLayer";
