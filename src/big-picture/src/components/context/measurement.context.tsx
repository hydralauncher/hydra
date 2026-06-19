import { createContext, useContext } from "react";

export const MeasurementContext = createContext(false);

export function useIsMeasurement() {
  return useContext(MeasurementContext);
}
