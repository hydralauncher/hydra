import type {
  NavigationActionButton,
  NavigationActionMode,
  NavigationScreenActionTarget,
  NavigationScreenActionContext,
  ScreenActions,
} from "../types";
import { NavigationService } from "./navigation.service";

interface RegisteredScreenActions {
  id: number;
  actions: ScreenActions;
}

export class NavigationScreenActionsService {
  private static instance: NavigationScreenActionsService;

  private readonly navigation = NavigationService.getInstance();
  private readonly stack: RegisteredScreenActions[] = [];
  private nextId = 0;

  public static getInstance() {
    if (!NavigationScreenActionsService.instance) {
      NavigationScreenActionsService.instance =
        new NavigationScreenActionsService();
    }

    return NavigationScreenActionsService.instance;
  }

  public registerActions(actions: ScreenActions) {
    const entry: RegisteredScreenActions = {
      id: this.nextId++,
      actions,
    };

    this.stack.push(entry);

    return () => {
      const index = this.stack.findIndex(
        (candidate) => candidate.id === entry.id
      );

      if (index === -1) return;

      this.stack.splice(index, 1);
    };
  }

  public updateActions(id: number, actions: ScreenActions) {
    const entry = this.stack.find((candidate) => candidate.id === id);

    if (!entry) return;

    entry.actions = actions;
  }

  public createRegistration(actions: ScreenActions) {
    const id = this.nextId++;

    this.stack.push({
      id,
      actions,
    });

    return {
      id,
      unregister: () => {
        const index = this.stack.findIndex((candidate) => candidate.id === id);

        if (index === -1) return;

        this.stack.splice(index, 1);
      },
    };
  }

  public triggerAction(
    mode: NavigationActionMode,
    button: NavigationActionButton,
    originalEvent: Event | null = null
  ) {
    for (let index = this.stack.length - 1; index >= 0; index -= 1) {
      const action = this.stack[index]?.actions[mode]?.[button];

      if (!action) continue;

      const context: NavigationScreenActionContext = {
        currentFocusId: this.navigation.getCurrentFocusId(),
        originalEvent,
      };

      if (typeof action === "function") {
        action(context);
        return true;
      }

      return this.resolveTargetAction(action, context);
    }

    return false;
  }

  public hasAction(mode: NavigationActionMode, button: NavigationActionButton) {
    for (let index = this.stack.length - 1; index >= 0; index -= 1) {
      if (this.stack[index]?.actions[mode]?.[button]) {
        return true;
      }
    }

    return false;
  }

  private resolveTargetAction(
    action: NavigationScreenActionTarget,
    context: NavigationScreenActionContext
  ) {
    const resolvedFocusId =
      action.type === "item"
        ? this.navigation.setFocus(action.itemId)
        : this.navigation.setFocusRegion(
            action.regionId,
            action.entryDirection ?? "right"
          );

    if (!resolvedFocusId) {
      if (process.env.NODE_ENV !== "production") {
        this.warnUnresolvedTarget(action, context);
      }

      return false;
    }

    action.onFocused?.();
    return true;
  }

  private warnUnresolvedTarget(
    action: NavigationScreenActionTarget,
    context: NavigationScreenActionContext
  ) {
    const targetDescription =
      action.type === "item"
        ? `item "${action.itemId}"`
        : `region "${action.regionId}"`;
    const onFocusedMessage = action.onFocused
      ? " The optional onFocused callback was skipped because the target could not be resolved."
      : "";

    console.warn(
      `Navigation screen action could not resolve ${targetDescription} while handling the active shell shortcut. Focus was left unchanged.${onFocusedMessage}`,
      {
        action,
        currentFocusId: context.currentFocusId,
      }
    );
  }
}
