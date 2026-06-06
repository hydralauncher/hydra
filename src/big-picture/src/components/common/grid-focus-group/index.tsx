import { Slot } from "@radix-ui/react-slot";
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
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
} from "react";

interface GridFocusGroupProps {
  regionId?: string;
  navigationOverrides?: FocusOverrides;
  autoScrollMode?: FocusAutoScrollMode;
  getScrollAnchor?: () => HTMLElement | null;
  asChild?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

export const GridFocusGroup = forwardRef<HTMLDivElement, GridFocusGroupProps>(
  (
    {
      regionId,
      navigationOverrides,
      autoScrollMode = "row",
      getScrollAnchor,
      asChild = false,
      className,
      style,
      children,
    },
    forwardedRef
  ) => {
    const generatedId = useId();
    const parentRegionId = useFocusRegionId();
    const layerId = useFocusLayerId();
    const navigation = NavigationService.getInstance();
    const initialNavigationOverridesRef = useRef(navigationOverrides);
    const initialGetScrollAnchorRef = useRef(getScrollAnchor);
    const ref = useRef<HTMLDivElement | null>(null);

    useImperativeHandle(forwardedRef, () => ref.current!);
    const resolvedRegionId =
      regionId ?? `focus-region-${generatedId.replaceAll(":", "")}`;

    useEffect(() => {
      return navigation.registerRegion({
        id: resolvedRegionId,
        parentRegionId,
        orientation: "grid",
        layerId,
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
        navigationOverrides,
      });
    }, [
      autoScrollMode,
      getScrollAnchor,
      navigation,
      navigationOverrides,
      resolvedRegionId,
    ]);

    const Component = asChild ? Slot : "div";

    return (
      <FocusRegionContext.Provider value={resolvedRegionId}>
        <Component
          ref={ref}
          data-focus-region-id={resolvedRegionId}
          className={className}
          style={style}
        >
          {children}
        </Component>
      </FocusRegionContext.Provider>
    );
  }
);

GridFocusGroup.displayName = "GridFocusGroup";
