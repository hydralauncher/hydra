import type { FocusItemActionsMeta } from "../../types";
import { createContext, useContext } from "react";

const defaultFocusItemActionsMeta: FocusItemActionsMeta = {
  hasPrimary: false,
  hasSecondary: false,
  hasPressX: false,
  hasPressY: false,
  hasHoldA: false,
  hasHoldB: false,
  hasHoldX: false,
};

export const FocusItemActionsMetaContext = createContext<FocusItemActionsMeta>(
  defaultFocusItemActionsMeta
);

export function useFocusItemActionsMeta() {
  return useContext(FocusItemActionsMetaContext);
}
