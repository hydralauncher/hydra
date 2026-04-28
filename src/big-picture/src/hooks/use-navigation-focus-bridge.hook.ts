import { NavigationFocusBridgeService } from "../services";
import { useCallback, useEffect } from "react";

const navigationFocusBridge = NavigationFocusBridgeService.getInstance();

export function useNavigationFocusBridge(
  itemId: string,
  onFocused: () => void
) {
  useEffect(() => {
    return navigationFocusBridge.register(itemId, onFocused);
  }, [itemId, onFocused]);

  return useCallback(() => {
    return navigationFocusBridge.focus(itemId);
  }, [itemId]);
}
