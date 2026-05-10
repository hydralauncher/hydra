import {
  NavigationItemActionsService,
  NavigationScreenActionsService,
  NavigationService,
  type FocusDirection,
} from "../services";
import type {
  FocusItemHoldButton,
  FocusItemPressButton,
  NavigationActionButton,
  NavigationDirectionAction,
} from "../types";
import { useNavigationSnapshot } from "../stores";
import { useCallback } from "react";

const navigation = NavigationService.getInstance();
const navigationItemActions = NavigationItemActionsService.getInstance();
const navigationScreenActions = NavigationScreenActionsService.getInstance();

export function useNavigationActions() {
  const registerRegion = useCallback(
    (region: Parameters<typeof navigation.registerRegion>[0]) => {
      return navigation.registerRegion(region);
    },
    []
  );

  const registerNavigationNode = useCallback(
    (node: Parameters<typeof navigation.registerNavigationNode>[0]) => {
      return navigation.registerNavigationNode(node);
    },
    []
  );

  const setFocus = useCallback((id: string) => {
    return navigation.setFocus(id);
  }, []);

  const setFocusRegion = useCallback(
    (
      regionId: string,
      entryDirection: FocusDirection = "right",
      options?: Parameters<typeof navigation.setFocusRegion>[2]
    ) => {
      return navigation.setFocusRegion(regionId, entryDirection, options);
    },
    []
  );

  const moveFocus = useCallback((direction: FocusDirection) => {
    return navigation.moveFocus(direction);
  }, []);

  const triggerPrimary = useCallback((originalEvent: Event | null = null) => {
    return navigationItemActions.triggerPrimaryForFocusedItem(originalEvent);
  }, []);

  const triggerSecondary = useCallback((originalEvent: Event | null = null) => {
    return navigationItemActions.triggerSecondaryForFocusedItem(originalEvent);
  }, []);

  const triggerItemPress = useCallback(
    (button: FocusItemPressButton, originalEvent: Event | null = null) => {
      return navigationItemActions.triggerPressActionForFocusedItem(
        button,
        originalEvent
      );
    },
    []
  );

  const triggerItemHold = useCallback(
    (button: FocusItemHoldButton, originalEvent: Event | null = null) => {
      return navigationItemActions.triggerHoldActionForFocusedItem(
        button,
        originalEvent
      );
    },
    []
  );

  const triggerScreenPress = useCallback(
    (button: NavigationActionButton, originalEvent: Event | null = null) => {
      return navigationScreenActions.triggerAction(
        "press",
        button,
        originalEvent
      );
    },
    []
  );

  const triggerScreenHold = useCallback(
    (button: NavigationActionButton, originalEvent: Event | null = null) => {
      return navigationScreenActions.triggerAction(
        "hold",
        button,
        originalEvent
      );
    },
    []
  );

  const canResolveFocusedPrimaryAction = useCallback(() => {
    return navigationItemActions.canResolvePrimaryForFocusedItem();
  }, []);

  const canResolveFocusedSecondaryAction = useCallback(() => {
    return navigationItemActions.hasSecondaryActionForFocusedItem();
  }, []);

  const hasFocusedItemPressAction = useCallback(
    (button: FocusItemPressButton) => {
      return navigationItemActions.hasPressActionForFocusedItem(button);
    },
    []
  );

  const hasFocusedItemHoldAction = useCallback(
    (button: FocusItemHoldButton) => {
      return navigationItemActions.hasHoldActionForFocusedItem(button);
    },
    []
  );

  const hasScreenPressAction = useCallback((button: NavigationActionButton) => {
    return navigationScreenActions.hasAction("press", button);
  }, []);

  const hasScreenHoldAction = useCallback((button: NavigationActionButton) => {
    return navigationScreenActions.hasAction("hold", button);
  }, []);

  const triggerScreenDirection = useCallback(
    (
      direction: NavigationDirectionAction,
      originalEvent: Event | null = null
    ) => {
      return navigationScreenActions.triggerDirection(direction, originalEvent);
    },
    []
  );

  const hasScreenDirectionAction = useCallback(
    (direction: NavigationDirectionAction) => {
      return navigationScreenActions.hasDirection(direction);
    },
    []
  );

  return {
    registerRegion,
    registerNavigationNode,
    setFocus,
    setFocusRegion,
    moveFocus,
    triggerPrimary,
    triggerSecondary,
    triggerItemPress,
    triggerItemHold,
    triggerScreenPress,
    triggerScreenHold,
    triggerScreenDirection,
    canResolveFocusedPrimaryAction,
    canResolveFocusedSecondaryAction,
    hasFocusedItemPressAction,
    hasFocusedItemHoldAction,
    hasScreenPressAction,
    hasScreenHoldAction,
    hasScreenDirectionAction,
  };
}

export function useNavigation() {
  const { currentFocusId, nodes, regions, layers, debugSnapshot } =
    useNavigationSnapshot();
  const actions = useNavigationActions();

  return {
    currentFocusId,
    nodes,
    regions,
    layers,
    debugSnapshot,
    ...actions,
  };
}
