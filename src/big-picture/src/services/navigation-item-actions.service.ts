import type {
  FocusItemActions,
  FocusItemHoldButton,
  FocusItemPressButton,
  NavigationActionContext,
} from "../types";
import { NavigationService } from "./navigation.service";

interface RegisteredFocusItemActions {
  itemId: string;
  actions: FocusItemActions;
  getElement: () => HTMLElement | null;
}

type PrimaryResolution =
  | {
      kind: "explicit-action";
      item: RegisteredFocusItemActions;
      context: NavigationActionContext;
      action: Exclude<FocusItemActions["primary"], "auto" | "off" | null>;
    }
  | {
      kind: "auto-click";
      item: RegisteredFocusItemActions;
      context: NavigationActionContext;
      target: HTMLElement;
    }
  | {
      kind: "unresolved";
      item: RegisteredFocusItemActions;
      reason:
        | "primary-off"
        | "missing-item"
        | "inactive-item"
        | "no-clickable-target";
    };

const PRIMARY_CLICKABLE_MARKER_SELECTOR = "[data-navigation-primary]";
const CLICKABLE_TARGET_SELECTOR = [
  "button",
  "a[href]",
  '[role="button"]',
  '[role="link"]',
  "[data-navigation-click]",
].join(", ");

function isDisabledClickableTarget(target: Element) {
  return target instanceof HTMLButtonElement
    ? target.disabled
    : target.getAttribute("aria-disabled") === "true";
}

export class NavigationItemActionsService {
  private static instance: NavigationItemActionsService;

  private readonly navigation = NavigationService.getInstance();
  private readonly items = new Map<string, RegisteredFocusItemActions>();

  public static getInstance() {
    if (!NavigationItemActionsService.instance) {
      NavigationItemActionsService.instance =
        new NavigationItemActionsService();
    }

    return NavigationItemActionsService.instance;
  }

  public registerItemActions(item: RegisteredFocusItemActions) {
    if (this.items.has(item.itemId)) {
      throw new Error(
        `Focus item actions for "${item.itemId}" are already registered.`
      );
    }

    this.items.set(item.itemId, item);

    return () => {
      this.items.delete(item.itemId);
    };
  }

  public triggerPrimaryForFocusedItem(originalEvent: Event | null = null) {
    const focusedItemId = this.navigation.getCurrentFocusId();

    if (!focusedItemId) {
      return false;
    }

    return this.triggerPrimaryForItem(focusedItemId, originalEvent);
  }

  public canResolvePrimaryForFocusedItem() {
    const resolution = this.resolvePrimaryForFocusedItem();

    return (
      resolution?.kind === "explicit-action" ||
      resolution?.kind === "auto-click"
    );
  }

  public triggerSecondaryForFocusedItem(originalEvent: Event | null = null) {
    const registeredItem = this.getFocusedRegisteredItem();

    if (!registeredItem) return false;

    const secondaryAction = registeredItem.actions.secondary;

    if (typeof secondaryAction !== "function") return false;

    secondaryAction(
      this.createActionContext(registeredItem.itemId, originalEvent)
    );

    return true;
  }

  public hasSecondaryActionForFocusedItem() {
    const registeredItem = this.getFocusedRegisteredItem();

    if (!registeredItem) return false;

    return typeof registeredItem.actions.secondary === "function";
  }

  public triggerPressActionForFocusedItem(
    button: FocusItemPressButton,
    originalEvent: Event | null = null
  ) {
    const registeredItem = this.getFocusedRegisteredItem();

    if (!registeredItem) return false;

    const action = registeredItem.actions.press?.[button];

    if (!action) return false;

    action(this.createActionContext(registeredItem.itemId, originalEvent));

    return true;
  }

  public hasPressActionForFocusedItem(button: FocusItemPressButton) {
    const registeredItem = this.getFocusedRegisteredItem();

    if (!registeredItem) return false;

    return Boolean(registeredItem.actions.press?.[button]);
  }

  public triggerHoldActionForFocusedItem(
    button: FocusItemHoldButton,
    originalEvent: Event | null = null
  ) {
    const registeredItem = this.getFocusedRegisteredItem();

    if (!registeredItem) return false;

    const action = registeredItem.actions.hold?.[button];

    if (!action) return false;

    action(this.createActionContext(registeredItem.itemId, originalEvent));

    return true;
  }

  public hasHoldActionForFocusedItem(button: FocusItemHoldButton) {
    const registeredItem = this.getFocusedRegisteredItem();

    if (!registeredItem) return false;

    return Boolean(registeredItem.actions.hold?.[button]);
  }

  private getFocusedRegisteredItem() {
    const focusedItemId = this.navigation.getCurrentFocusId();

    if (!focusedItemId) return null;

    if (!this.navigation.isNodeActive(focusedItemId)) {
      return null;
    }

    return this.items.get(focusedItemId) ?? null;
  }

  private triggerPrimaryForItem(itemId: string, originalEvent: Event | null) {
    const resolution = this.resolvePrimaryForItem(itemId, originalEvent);

    if (!resolution) return false;

    if (resolution.kind === "explicit-action") {
      resolution.action(resolution.context);
      return true;
    }

    if (resolution.kind === "auto-click") {
      resolution.target.click();
      return true;
    }

    if (
      resolution.kind === "unresolved" &&
      resolution.reason === "no-clickable-target" &&
      process.env.NODE_ENV !== "production"
    ) {
      console.warn(
        `Navigation primary action could not be resolved for focused item "${resolution.item.itemId}". "primary: \\"auto\\"" did not find a valid clickable target. Add an explicit primary action, render a clickable element or \`data-navigation-click\`, or mark the intended target with \`data-navigation-primary\`.`
      );
    }

    return false;
  }

  private resolvePrimaryForFocusedItem(originalEvent: Event | null = null) {
    const focusedItemId = this.navigation.getCurrentFocusId();

    if (!focusedItemId) return null;

    return this.resolvePrimaryForItem(focusedItemId, originalEvent);
  }

  private resolvePrimaryForItem(
    itemId: string,
    originalEvent: Event | null
  ): PrimaryResolution | null {
    const registeredItem = this.items.get(itemId);

    if (!registeredItem) {
      return {
        kind: "unresolved",
        item: {
          itemId,
          actions: {
            primary: "auto",
          },
          getElement: () => null,
        },
        reason: "missing-item",
      };
    }

    if (!this.navigation.isNodeActive(itemId)) {
      return {
        kind: "unresolved",
        item: registeredItem,
        reason: "inactive-item",
      };
    }

    const context = this.createActionContext(itemId, originalEvent);
    const primaryAction = registeredItem.actions.primary;

    if (typeof primaryAction === "function") {
      return {
        kind: "explicit-action",
        item: registeredItem,
        context,
        action: primaryAction,
      };
    }

    if (primaryAction === "off" || primaryAction === null) {
      return {
        kind: "unresolved",
        item: registeredItem,
        reason: "primary-off",
      };
    }

    if (context.clickableTarget) {
      return {
        kind: "auto-click",
        item: registeredItem,
        context,
        target: context.clickableTarget,
      };
    }

    return {
      kind: "unresolved",
      item: registeredItem,
      reason: "no-clickable-target",
    };
  }

  private createActionContext(
    itemId: string,
    originalEvent: Event | null
  ): NavigationActionContext & { clickableTarget: HTMLElement | null } {
    const clickableTarget = this.getClickableTarget(itemId);

    return {
      itemId,
      clickableTarget,
      click: () => {
        clickableTarget?.click();
      },
      hasClickableTarget: clickableTarget !== null,
      originalEvent,
    };
  }

  private getClickableTarget(itemId: string) {
    const item = this.items.get(itemId);
    const itemElement = item?.getElement();

    if (!itemElement) return null;

    const explicitPrimaryTarget = Array.from(
      itemElement.querySelectorAll(PRIMARY_CLICKABLE_MARKER_SELECTOR)
    ).find((target): target is HTMLElement => {
      return this.isValidClickableTarget(target);
    });

    if (explicitPrimaryTarget) {
      return explicitPrimaryTarget;
    }

    if (this.isValidClickableTarget(itemElement)) {
      return itemElement;
    }

    const descendantClickableTarget = Array.from(
      itemElement.querySelectorAll(CLICKABLE_TARGET_SELECTOR)
    ).find((target): target is HTMLElement => {
      return this.isValidClickableTarget(target);
    });

    return descendantClickableTarget ?? null;
  }

  private isValidClickableTarget(target: Element) {
    return (
      target instanceof HTMLElement &&
      target.matches(CLICKABLE_TARGET_SELECTOR) &&
      !isDisabledClickableTarget(target)
    );
  }
}
