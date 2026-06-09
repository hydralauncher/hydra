import { NavigationService } from "../../services";
import { useNavigationStore } from "../../stores";
import { useEffect } from "react";

const navigation = NavigationService.getInstance();

export function NavigationStateBridge() {
  useEffect(() => {
    useNavigationStore.getState().syncFromService(navigation);

    return navigation.subscribe(() => {
      useNavigationStore.getState().syncFromService(navigation);
    });
  }, []);

  return null;
}
