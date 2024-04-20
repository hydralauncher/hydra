import type { Repack, RepackerFriendlyName, SteamGame } from "@main/entity";

interface State {
  repacks: Repack[];
  repackersFriendlyNames: RepackerFriendlyName[];
  steamGames: SteamGame[];
  eventResults: Map<[string, any[]], any>;
}

const initialState: State = {
  repacks: [],
  repackersFriendlyNames: [],
  steamGames: [],
  eventResults: new Map(),
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
