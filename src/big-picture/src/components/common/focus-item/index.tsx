import { Slot } from "@radix-ui/react-slot";
import {
  FocusItemActionsMetaContext,
  useFocusLayerId,
  useFocusRegionId,
} from "../../context";
import { useIsMeasurement } from "../../context/measurement.context";
import {
  getFocusItemActionsMeta,
  resolveFocusItemActions,
  type FocusItemActions,
} from "../../../types";
import {
  type FocusOverrides,
  NavigationItemActionsService,
  NavigationService,
  type NavigationNodeState,
} from "../../../services";
import { useNavigationIsFocused, useNavigationStore } from "../../../stores";
import {
  type FocusEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
} from "react";

interface FocusItemProps {
  id?: string;
  actions?: FocusItemActions;
  /** When false and navigation would be active, the item is skipped in spatial navigation (same as `navigationState="hidden"`). */
  focusable?: boolean;
  navigationState?: NavigationNodeState;
  navigationOrder?: number;
  navigationOverrides?: FocusOverrides;
  stealFocusOnAppear?: boolean;
  asChild?: boolean;
  children: ReactNode;
}

export function FocusItem({
  id,
  actions,
  focusable = true,
  navigationState: navigationStateProp = "active",
  navigationOrder,
  navigationOverrides,
  stealFocusOnAppear = false,
  asChild = false,
  children,
}: Readonly<FocusItemProps>) {
  const effectiveNavigationState: NavigationNodeState =
    !focusable && navigationStateProp === "active"
      ? "hidden"
      : navigationStateProp;

  const generatedId = useId();
  const regionId = useFocusRegionId();
  const layerId = useFocusLayerId();
  const navigation = NavigationService.getInstance();
  const navigationItemActions = NavigationItemActionsService.getInstance();
  const ref = useRef<HTMLDivElement | null>(null);
  const initialNavigationStateRef = useRef(effectiveNavigationState);
  const initialNavigationOrderRef = useRef(navigationOrder);
  const initialNavigationOverridesRef = useRef(navigationOverrides);
  const wasActiveRef = useRef(false);
  const hasReceivedFocusOnCurrentAppearanceRef = useRef(false);
  const resolvedId = id ?? `focus-item-${generatedId.replaceAll(":", "")}`;
  const isFocused = useNavigationIsFocused(resolvedId);
  const currentFocusId = useNavigationStore((state) => state.currentFocusId);
  const isMeasurement = useIsMeasurement();

  const resolvedActions = useMemo(
    () => resolveFocusItemActions(actions),
    [actions]
  );

  const actionsMeta = useMemo(
    () => getFocusItemActionsMeta(resolvedActions),
    [resolvedActions]
  );

  if (!regionId) {
    throw new Error("FocusItem must be rendered inside a focus group.");
  }

  useEffect(() => {
    if (isMeasurement) return;

    return navigation.registerNavigationNode({
      id: resolvedId,
      regionId,
      layerId,
      navigationState: initialNavigationStateRef.current,
      navigationOrder: initialNavigationOrderRef.current,
      navigationOverrides: initialNavigationOverridesRef.current,
      getElement: () => ref.current,
    });
  }, [layerId, navigation, regionId, resolvedId]);

  useEffect(() => {
    navigation.updateNavigationNode(resolvedId, {
      navigationState: effectiveNavigationState,
      navigationOrder,
      navigationOverrides,
    });
  }, [
    navigation,
    effectiveNavigationState,
    navigationOrder,
    navigationOverrides,
    resolvedId,
  ]);

  useEffect(() => {
    if (isMeasurement) return;

    const isActive = effectiveNavigationState === "active";

    if (!isActive) {
      wasActiveRef.current = false;
      hasReceivedFocusOnCurrentAppearanceRef.current = false;
      return;
    }

    const hasAppeared = !wasActiveRef.current;
    wasActiveRef.current = true;

    if (!stealFocusOnAppear) {
      return;
    }

    if (isFocused) {
      hasReceivedFocusOnCurrentAppearanceRef.current = true;
      return;
    }

    if (!hasAppeared && hasReceivedFocusOnCurrentAppearanceRef.current) {
      return;
    }

    navigation.requestFocusWhenAvailable(resolvedId);
  }, [
    currentFocusId,
    effectiveNavigationState,
    isFocused,
    navigation,
    resolvedId,
    stealFocusOnAppear,
  ]);

  useEffect(() => {
    if (isMeasurement) return;

    return navigationItemActions.registerItemActions({
      itemId: resolvedId,
      actions: resolvedActions,
      getElement: () => ref.current,
    });
  }, [navigationItemActions, resolvedActions, resolvedId]);

  useEffect(() => {
    if (!isFocused) return;

    const element = ref.current;

    if (!element) return;

    try {
      element.focus({ preventScroll: true });
    } catch {
      element.focus();
    }
  }, [isFocused]);

  const handleDomFocus = useCallback(
    (_event: FocusEvent<HTMLElement>) => {
      if (effectiveNavigationState !== "active") {
        return;
      }

      if (navigation.getCurrentFocusId() === resolvedId) {
        return;
      }

      navigation.setFocus(resolvedId);
    },
    [effectiveNavigationState, navigation, resolvedId]
  );

  const Component = asChild ? Slot : "div";

  return (
    <FocusItemActionsMetaContext.Provider value={actionsMeta}>
      <Component
        id={resolvedId}
        ref={ref}
        data-focused={isFocused}
        data-focus-visible={isFocused || undefined}
        data-focus-wrapper={!asChild || undefined}
        data-has-primary={actionsMeta.hasPrimary || undefined}
        data-has-secondary={actionsMeta.hasSecondary || undefined}
        data-has-press-x={actionsMeta.hasPressX || undefined}
        data-has-press-y={actionsMeta.hasPressY || undefined}
        data-has-hold-a={actionsMeta.hasHoldA || undefined}
        data-has-hold-b={actionsMeta.hasHoldB || undefined}
        data-has-hold-x={actionsMeta.hasHoldX || undefined}
        data-has-hold-y={actionsMeta.hasHoldY || undefined}
        data-navigation-state={effectiveNavigationState}
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={isFocused ? 0 : -1}
        onFocus={handleDomFocus}
        style={asChild ? undefined : { outline: "none" }}
      >
        {children}
      </Component>
    </FocusItemActionsMetaContext.Provider>
  );
}
