import { createContext, useContext } from "react";

export const FocusRegionContext = createContext<string | null>(null);

export function useFocusRegionId() {
  return useContext(FocusRegionContext);
}
