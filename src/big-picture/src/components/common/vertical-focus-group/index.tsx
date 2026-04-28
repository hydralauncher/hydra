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
  useEffect,
  useId,
  useRef,
} from "react";

interface VerticalFocusGroupProps extends HTMLAttributes<HTMLDivElement> {
  regionId?: string;
  navigationOverrides?: FocusOverrides;
  autoScrollMode?: FocusAutoScrollMode;
  getScrollAnchor?: () => HTMLElement | null;
  asChild?: boolean;
  children: ReactNode;
}

export function VerticalFocusGroup({
  regionId,
  navigationOverrides,
  autoScrollMode = "auto",
  getScrollAnchor,
  asChild = false,
  className,
  style,
  children,
  ...props
}: Readonly<VerticalFocusGroupProps>) {
  const generatedId = useId();
  const parentRegionId = useFocusRegionId();
  const layerId = useFocusLayerId();
  const navigation = NavigationService.getInstance();
  const initialNavigationOverridesRef = useRef(navigationOverrides);
  const initialGetScrollAnchorRef = useRef(getScrollAnchor);
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
        className={className}
        data-focus-region-id={resolvedRegionId}
        style={
          asChild
            ? style
            : {
                display: "flex",
                flexDirection: "column",
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
