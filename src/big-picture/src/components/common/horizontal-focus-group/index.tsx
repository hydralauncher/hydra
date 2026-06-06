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
  type HTMLAttributes,
  type ReactNode,
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
} from "react";

interface HorizontalFocusGroupProps extends HTMLAttributes<HTMLDivElement> {
  regionId?: string;
  navigationOrder?: number;
  navigationOverrides?: FocusOverrides;
  autoScrollMode?: FocusAutoScrollMode;
  getScrollAnchor?: () => HTMLElement | null;
  asChild?: boolean;
  children: ReactNode;
}

export const HorizontalFocusGroup = forwardRef<
  HTMLDivElement,
  HorizontalFocusGroupProps
>(
  (
    {
      regionId,
      navigationOrder,
      navigationOverrides,
      autoScrollMode = "region",
      getScrollAnchor,
      asChild = false,
      className,
      style,
      children,
      ...props
    },
    forwardedRef
  ) => {
    const generatedId = useId();
    const parentRegionId = useFocusRegionId();
    const layerId = useFocusLayerId();
    const navigation = NavigationService.getInstance();
    const initialNavigationOrderRef = useRef(navigationOrder);
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
        orientation: "horizontal",
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

    const Component = asChild ? Slot : "div";

    return (
      <FocusRegionContext.Provider value={resolvedRegionId}>
        <Component
          ref={ref}
          className={className}
          data-focus-region-id={resolvedRegionId}
          style={
            asChild
              ? style
              : {
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  ...style,
                }
          }
          {...props}
        >
          {children}
        </Component>
      </FocusRegionContext.Provider>
    );
  }
);

HorizontalFocusGroup.displayName = "HorizontalFocusGroup";
