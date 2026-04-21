import { useFocusLayerId } from "../../context";
import { FocusRegionContext, useFocusRegionId } from "../../context";
import { type FocusOverrides, NavigationService } from "../../../services";
import { useEffect, useId, useRef } from "react";
import React from "react";

interface HorizontalFocusGroupProps {
  regionId?: string;
  navigationOverrides?: FocusOverrides;
  children: React.ReactNode;
}

export function HorizontalFocusGroup({
  regionId,
  navigationOverrides,
  children,
}: HorizontalFocusGroupProps) {
  const generatedId = useId();
  const parentRegionId = useFocusRegionId();
  const layerId = useFocusLayerId();
  const navigation = NavigationService.getInstance();
  const initialNavigationOverridesRef = useRef(navigationOverrides);
  const resolvedRegionId =
    regionId ?? `focus-region-${generatedId.replace(/:/g, "")}`;

  useEffect(() => {
    return navigation.registerRegion({
      id: resolvedRegionId,
      parentRegionId,
      orientation: "horizontal",
      layerId,
      navigationOverrides: initialNavigationOverridesRef.current,
      isPersistent: Boolean(regionId),
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
        data-focus-region-id={resolvedRegionId}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}
      >
        {children}
      </div>
    </FocusRegionContext.Provider>
  );
}
