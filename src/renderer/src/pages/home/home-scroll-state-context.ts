import { createContext, useContext } from "react";

export interface HomeScrollState {
  isScrollingRef: { current: boolean };
  subscribe: (cb: () => void) => () => void;
}

const noopRef = { current: false };
const noopSubscribe = (_cb: () => void): (() => void) => {
  return () => {};
};

export const HomeScrollStateContext = createContext<HomeScrollState>({
  isScrollingRef: noopRef,
  subscribe: noopSubscribe,
});

export const useHomeScrollState = () => useContext(HomeScrollStateContext);
