import { create } from "zustand";
import {
  type FocusLayer,
  NavigationService,
  type FocusNode,
  type FocusRegion,
  type NavigationDebugSnapshot,
} from "../services";

interface NavigationStoreSnapshot {
  currentFocusId: string | null;
  nodes: FocusNode[];
  regions: FocusRegion[];
  layers: FocusLayer[];
  debugSnapshot: NavigationDebugSnapshot;
}

interface NavigationStoreState extends NavigationStoreSnapshot {
  syncFromService: (navigation?: NavigationService) => void;
  syncFromSnapshot: (snapshot: NavigationStoreSnapshot) => void;
}

const navigation = NavigationService.getInstance();

const getSnapshotFromService = (
  source: NavigationService = navigation
): NavigationStoreSnapshot => ({
  currentFocusId: source.getCurrentFocusId(),
  nodes: source.getNodes(),
  regions: source.getRegions(),
  layers: source.getLayers(),
  debugSnapshot: source.getDebugSnapshot(),
});

export const useNavigationStore = create<NavigationStoreState>((set) => ({
  ...getSnapshotFromService(),

  syncFromService: (source = navigation) => {
    set(getSnapshotFromService(source));
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
