import { createContext, useContext } from "react";

export const HomeHydrationContext = createContext<boolean>(false);

export const useHomeHydration = () => useContext(HomeHydrationContext);
