import { create } from "zustand";
import { GamepadRawState, GamepadService } from "../services";

type GamepadStateMap = Map<number, GamepadRawState>;

interface GamepadInfo {
  index: number;
  name: string;
  layout: string;
}

export interface GamepadState {
  states: Map<number, GamepadRawState>;
  connectedGamepads: GamepadInfo[];
  hasGamepadConnected: boolean;
  activeGamepadIndex: number | null;

  sync: () => void;
  getActiveGamepad: () => GamepadInfo | null;
  getService: () => GamepadService;
}

export const useGamepadStore = create<GamepadState>((set, get) => {
  let cachedConnectedGamepads: GamepadInfo[] = [];
  let lastConnectedCount = 0;
  let isInitialized = false;

  const ensureInitialized = () => {
    if (isInitialized) return;

    isInitialized = true;

    const service = GamepadService.getInstance();
    service.onStateChange(() => {
      get().sync();
    });
  };

  return {
    states: new Map(),
    connectedGamepads: [],
    hasGamepadConnected: false,
    activeGamepadIndex: null,

    sync: () => {
      ensureInitialized();

      const service = GamepadService.getInstance();
      const rawStates = service.getCurrentState() as GamepadStateMap;
      const hasGamepadConnected = rawStates.size > 0;
      const activeGamepadIndex = service.getActiveGamepadIndex();

      let connectedGamepads = cachedConnectedGamepads;

      if (rawStates.size !== lastConnectedCount) {
        connectedGamepads = Array.from(rawStates.entries()).map(
          ([idx, state]) => ({
            index: idx,
            name: state.name,
            layout: state.layout,
          })
        );

        cachedConnectedGamepads = connectedGamepads;
        lastConnectedCount = rawStates.size;
      }

      set({
        states: rawStates,
        hasGamepadConnected,
        connectedGamepads,
        activeGamepadIndex,
      });
    },

    getActiveGamepad: () => {
      const activeGamepadIndex = get().activeGamepadIndex;

      if (activeGamepadIndex === null) return null;

      const state = get().states.get(activeGamepadIndex);
      if (!state) return null;

      return {
        index: activeGamepadIndex,
        name: state.name,
        layout: state.layout,
      };
    },

    getService: () => GamepadService.getInstance(),
  };
});
