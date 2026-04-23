export type NavigationActionButton = "a" | "b" | "x" | "y" | "start" | "select";

export type NavigationActionMode = "press" | "hold";
export type FocusItemPressButton = "x" | "y";
export type FocusItemHoldButton = "a" | "b" | "x";
export type NavigationTargetType = "item" | "region";

export interface NavigationActionContext {
  itemId: string;
  click: () => void;
  hasClickableTarget: boolean;
  originalEvent: Event | null;
}

export interface NavigationScreenActionContext {
  currentFocusId: string | null;
  originalEvent: Event | null;
}

export type ActionHandler = (ctx: NavigationActionContext) => void;
export type ScreenActionHandler = (ctx: NavigationScreenActionContext) => void;
export type NavigationTargetFocusedHandler = () => void;

export interface NavigationItemTarget {
  type: "item";
  itemId: string;
  onFocused?: NavigationTargetFocusedHandler;
}

export interface NavigationRegionTarget {
  type: "region";
  regionId: string;
  entryDirection?: import("../services").FocusDirection;
  onFocused?: NavigationTargetFocusedHandler;
}

export type NavigationScreenActionTarget =
  | NavigationItemTarget
  | NavigationRegionTarget;

export type ScreenActionDefinition =
  | ScreenActionHandler
  | NavigationScreenActionTarget;

export type FocusItemPrimaryAction = "auto" | "off" | null | ActionHandler;
export type FocusItemSecondaryAction = "off" | null | ActionHandler;

export interface FocusItemActions {
  primary: FocusItemPrimaryAction;
  secondary?: FocusItemSecondaryAction;
  press?: {
    x?: ActionHandler;
    y?: ActionHandler;
  };
  hold?: {
    a?: ActionHandler;
    b?: ActionHandler;
    x?: ActionHandler;
  };
}

export interface ScreenActions {
  press?: Partial<Record<NavigationActionButton, ScreenActionDefinition>>;
  hold?: Partial<Record<NavigationActionButton, ScreenActionDefinition>>;
}

export interface FocusItemActionsMeta {
  hasPrimary: boolean;
  hasSecondary: boolean;
  hasPressX: boolean;
  hasPressY: boolean;
  hasHoldA: boolean;
  hasHoldB: boolean;
  hasHoldX: boolean;
}

export const DEFAULT_FOCUS_ITEM_ACTIONS: FocusItemActions = {
  primary: "auto",
};

export function resolveFocusItemActions(
  actions?: FocusItemActions
): FocusItemActions {
  if (!actions) {
    return DEFAULT_FOCUS_ITEM_ACTIONS;
  }

  return {
    ...actions,
    primary: actions.primary ?? "auto",
  };
}

export function getFocusItemActionsMeta(
  actions?: FocusItemActions
): FocusItemActionsMeta {
  const resolvedActions = resolveFocusItemActions(actions);

  return {
    hasPrimary:
      resolvedActions.primary !== "off" && resolvedActions.primary !== null,
    hasSecondary:
      resolvedActions.secondary !== "off" &&
      resolvedActions.secondary !== null &&
      resolvedActions.secondary !== undefined,
    hasPressX: Boolean(resolvedActions.press?.x),
    hasPressY: Boolean(resolvedActions.press?.y),
    hasHoldA: Boolean(resolvedActions.hold?.a),
    hasHoldB: Boolean(resolvedActions.hold?.b),
    hasHoldX: Boolean(resolvedActions.hold?.x),
  };
}
