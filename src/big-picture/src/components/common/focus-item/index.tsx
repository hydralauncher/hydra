import { FocusItemActionsMetaContext } from "../../context";
import { useFocusLayerId } from "../../context";
import {
  getFocusItemActionsMeta,
  resolveFocusItemActions,
  type FocusItemActions,
} from "../../../types";
import { useFocusRegionId } from "../../context";
import { NavigationItemActionsService } from "../../../services";
import {
  type FocusOverrides,
  NavigationService,
  type NavigationNodeState,
} from "../../../services";
import { useNavigationIsFocused } from "../../../stores";
import { useEffect, useId, useMemo, useRef } from "react";

interface FocusItemProps {
  id?: string;
  actions?: FocusItemActions;
  navigationState?: NavigationNodeState;
  navigationOverrides?: FocusOverrides;
  children: React.ReactNode;
}

export function FocusItem({
  id,
  actions,
  navigationState = "active",
  navigationOverrides,
  children,
}: FocusItemProps) {
  const generatedId = useId();
  const regionId = useFocusRegionId();
  const layerId = useFocusLayerId();
  const navigation = NavigationService.getInstance();
  const navigationItemActions = NavigationItemActionsService.getInstance();
  const ref = useRef<HTMLDivElement | null>(null);
  const initialNavigationStateRef = useRef(navigationState);
  const initialNavigationOverridesRef = useRef(navigationOverrides);
  const resolvedId = id ?? `focus-item-${generatedId.replace(/:/g, "")}`;
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

    ref.current?.focus();
  }, [isFocused]);

  return (
    <FocusItemActionsMetaContext.Provider value={actionsMeta}>
      <div
        id={resolvedId}
        ref={ref}
        data-focused={isFocused}
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
        style={{
          outline: isFocused ? "1px solid white" : "none",
          outlineOffset: isFocused ? "2px" : "0px",
        }}
      >
        {children}
      </div>
    </FocusItemActionsMetaContext.Provider>
  );
}
