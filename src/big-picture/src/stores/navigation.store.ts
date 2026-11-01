import { create } from "zustand";
import { NavigationService } from "../services";
import {
  getNavigationSnapshot,
  type NavigationStoreSnapshot,
} from "./navigation-snapshot";

interface NavigationStoreState extends NavigationStoreSnapshot {
  syncFromService: (navigation?: NavigationService) => void;
  syncFromSnapshot: (snapshot: NavigationStoreSnapshot) => void;
}

const navigation = NavigationService.getInstance();

export const useNavigationStore = create<NavigationStoreState>((set, get) => ({
  ...getNavigationSnapshot(navigation),

  syncFromService: (source = navigation) => {
    set(getNavigationSnapshot(source, get()));
  },

  syncFromSnapshot: (snapshot) => {
    set(snapshot);
  },
}));

export function useNavigationIsFocused(id: string) {
  return useNavigationStore((state) => state.currentFocusId === id);
}

export function useNavigationDebugState() {
  const currentFocusId = useNavigationStore((state) => state.currentFocusId);
  const nodes = useNavigationStore((state) => state.nodes);
  const regions = useNavigationStore((state) => state.regions);
  const layers = useNavigationStore((state) => state.layers);
  const debugSnapshot = useNavigationStore((state) => state.debugSnapshot);

  return {
    currentFocusId,
    nodes,
    regions,
    layers,
    debugSnapshot,
  };
}

export function useNavigationSnapshot() {
  return useNavigationDebugState();
}
