import type { Repack } from "@main/entity";
import type { SteamGame } from "@types";

interface State {
  repacks: Repack[];
  steamGames: SteamGame[];
}

const initialState: State = {
  repacks: [],
  steamGames: [],
};

export class StateManager {
  private state = initialState;

  public setValue<T extends keyof State>(key: T, value: State[T]) {
    this.state = { ...this.state, [key]: value };
  }

  public getValue<T extends keyof State>(key: T) {
    return this.state[key];
  }

  public clearValue<T extends keyof State>(key: T) {
    this.state = { ...this.state, [key]: initialState[key] };
  }
}

export const stateManager = new StateManager();
