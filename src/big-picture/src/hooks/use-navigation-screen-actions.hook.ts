import type { ScreenActions } from "../types";
import { NavigationScreenActionsService } from "../services";
import { useEffect, useRef } from "react";

const navigationScreenActions = NavigationScreenActionsService.getInstance();

export function useNavigationScreenActions(actions: ScreenActions) {
  const registrationIdRef = useRef<number | null>(null);
  const initialActionsRef = useRef(actions);

  useEffect(() => {
    const registration = navigationScreenActions.createRegistration(
      initialActionsRef.current
    );
    registrationIdRef.current = registration.id;

    return registration.unregister;
  }, []);

  useEffect(() => {
    if (registrationIdRef.current === null) {
      return;
    }

    navigationScreenActions.updateActions(registrationIdRef.current, actions);
  }, [actions]);
}
