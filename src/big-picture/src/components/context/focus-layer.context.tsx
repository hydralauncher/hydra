import { ROOT_NAVIGATION_LAYER_ID } from "../../services";
import { createContext, useContext } from "react";

export const FocusLayerContext = createContext<string>(
  ROOT_NAVIGATION_LAYER_ID
);

export function useFocusLayerId() {
  return useContext(FocusLayerContext);
}
