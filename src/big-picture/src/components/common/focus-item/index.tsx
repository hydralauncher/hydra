import { Slot } from "@radix-ui/react-slot";
import {
  FocusItemActionsMetaContext,
  useFocusLayerId,
  useFocusRegionId,
} from "../../context";
import {
  getFocusItemActionsMeta,
  resolveFocusItemActions,
  type FocusItemActions,
} from "../../../types";
import { scrollFocusedElementIntoView } from "../../../helpers";
import {
  type FocusOverrides,
  NavigationItemActionsService,
  NavigationService,
  type NavigationNodeState,
} from "../../../services";
import { useNavigationIsFocused } from "../../../stores";
import { type ReactNode, useEffect, useId, useMemo, useRef } from "react";

interface FocusItemProps {
  id?: string;
  actions?: FocusItemActions;
  navigationState?: NavigationNodeState;
  navigationOverrides?: FocusOverrides;
  asChild?: boolean;
  children: ReactNode;
}

export function FocusItem({
  id,
  actions,
  navigationState = "active",
  navigationOverrides,
  asChild = false,
  children,
}: Readonly<FocusItemProps>) {
  const generatedId = useId();
  const regionId = useFocusRegionId();
  const layerId = useFocusLayerId();
  const navigation = NavigationService.getInstance();
  const navigationItemActions = NavigationItemActionsService.getInstance();
  const ref = useRef<HTMLDivElement | null>(null);
  const initialNavigationStateRef = useRef(navigationState);
  const initialNavigationOverridesRef = useRef(navigationOverrides);
  const resolvedId = id ?? `focus-item-${generatedId.replaceAll(":", "")}`;
  const isFocused = useNavigationIsFocused(resolvedId);

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
    return navigation.registerNavigationNode({
      id: resolvedId,
      regionId,
      layerId,
      navigationState: initialNavigationStateRef.current,
      navigationOverrides: initialNavigationOverridesRef.current,
      getElement: () => ref.current,
    });
  }, [layerId, navigation, regionId, resolvedId]);

  useEffect(() => {
    navigation.updateNavigationNode(resolvedId, {
      navigationState,
      navigationOverrides,
    });
  }, [navigation, navigationOverrides, navigationState, resolvedId]);

  useEffect(() => {
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

    scrollFocusedElementIntoView(element);
  }, [isFocused]);

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
        data-navigation-state={navigationState}
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={isFocused ? 0 : -1}
        style={!asChild ? { outline: "none" } : undefined}
      >
        {children}
      </Component>
    </FocusItemActionsMetaContext.Provider>
  );
}
