type FocusBridgeCallback = () => void;

export class NavigationFocusBridgeService {
  private static instance: NavigationFocusBridgeService;

  private readonly callbacks = new Map<string, FocusBridgeCallback>();

  public static getInstance() {
    if (!NavigationFocusBridgeService.instance) {
      NavigationFocusBridgeService.instance =
        new NavigationFocusBridgeService();
    }

    return NavigationFocusBridgeService.instance;
  }

  public register(itemId: string, callback: FocusBridgeCallback) {
    this.callbacks.set(itemId, callback);

    return () => {
      const registeredCallback = this.callbacks.get(itemId);

      if (registeredCallback !== callback) return;

      this.callbacks.delete(itemId);
    };
  }

  public focus(itemId: string) {
    const callback = this.callbacks.get(itemId);

    if (!callback) return false;

    callback();
    return true;
  }
}
