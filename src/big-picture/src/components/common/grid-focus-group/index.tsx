import {
  FocusRegionContext,
  useFocusLayerId,
  useFocusRegionId,
} from "../../context";
import {
  type FocusAutoScrollMode,
  type FocusOverrides,
  NavigationService,
} from "../../../services";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from "react";

interface GridFocusGroupProps {
  regionId?: string;
  navigationOrder?: number;
  navigationOverrides?: FocusOverrides;
  autoScrollMode?: FocusAutoScrollMode;
  getScrollAnchor?: () => HTMLElement | null;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

export function GridFocusGroup({
  regionId,
  navigationOrder,
  navigationOverrides,
  autoScrollMode = "row",
  getScrollAnchor,
  className,
  style,
  children,
}: Readonly<GridFocusGroupProps>) {
  const generatedId = useId();
  const parentRegionId = useFocusRegionId();
  const layerId = useFocusLayerId();
  const navigation = NavigationService.getInstance();
  const initialNavigationOrderRef = useRef(navigationOrder);
  const initialNavigationOverridesRef = useRef(navigationOverrides);
  const initialGetScrollAnchorRef = useRef(getScrollAnchor);
  const ref = useRef<HTMLDivElement | null>(null);
  const resolvedRegionId =
    regionId ?? `focus-region-${generatedId.replaceAll(":", "")}`;

  useEffect(() => {
    return navigation.registerRegion({
      id: resolvedRegionId,
      parentRegionId,
      orientation: "grid",
      layerId,
      navigationOrder: initialNavigationOrderRef.current,
      navigationOverrides: initialNavigationOverridesRef.current,
      autoScrollMode,
      isPersistent: Boolean(regionId),
      getElement: () => ref.current,
      getScrollAnchor: initialGetScrollAnchorRef.current,
    });
  }, [
    autoScrollMode,
    layerId,
    navigation,
    parentRegionId,
    regionId,
    resolvedRegionId,
  ]);

  useEffect(() => {
    navigation.updateRegion(resolvedRegionId, {
      autoScrollMode,
      getScrollAnchor,
      navigationOrder,
      navigationOverrides,
    });
  }, [
    autoScrollMode,
    getScrollAnchor,
    navigation,
    navigationOrder,
    navigationOverrides,
    resolvedRegionId,
  ]);

  return (
    <FocusRegionContext.Provider value={resolvedRegionId}>
      <div
        ref={ref}
        data-focus-region-id={resolvedRegionId}
        className={className}
        style={style}
      >
        {children}
      </div>
    </FocusRegionContext.Provider>
  );
}
