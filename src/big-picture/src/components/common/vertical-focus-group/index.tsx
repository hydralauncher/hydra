import {
  FocusRegionContext,
  useFocusLayerId,
  useFocusRegionId,
} from "../../context";
import { type FocusOverrides, NavigationService } from "../../../services";
import { type ReactNode, useEffect, useId, useRef } from "react";

interface VerticalFocusGroupProps {
  regionId?: string;
  navigationOverrides?: FocusOverrides;
  children: ReactNode;
}

export function VerticalFocusGroup({
  regionId,
  navigationOverrides,
  children,
}: Readonly<VerticalFocusGroupProps>) {
  const generatedId = useId();
  const parentRegionId = useFocusRegionId();
  const layerId = useFocusLayerId();
  const navigation = NavigationService.getInstance();
  const initialNavigationOverridesRef = useRef(navigationOverrides);
  const ref = useRef<HTMLDivElement | null>(null);
  const resolvedRegionId =
    regionId ?? `focus-region-${generatedId.replaceAll(":", "")}`;

  useEffect(() => {
    return navigation.registerRegion({
      id: resolvedRegionId,
      parentRegionId,
      orientation: "vertical",
      layerId,
      navigationOverrides: initialNavigationOverridesRef.current,
      isPersistent: Boolean(regionId),
      getElement: () => ref.current,
    });
  }, [layerId, navigation, parentRegionId, regionId, resolvedRegionId]);

  useEffect(() => {
    navigation.updateRegion(resolvedRegionId, {
      navigationOverrides,
    });
  }, [navigation, navigationOverrides, resolvedRegionId]);

  return (
    <FocusRegionContext.Provider value={resolvedRegionId}>
      <div
        ref={ref}
        data-focus-region-id={resolvedRegionId}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {children}
      </div>
    </FocusRegionContext.Provider>
  );
}
