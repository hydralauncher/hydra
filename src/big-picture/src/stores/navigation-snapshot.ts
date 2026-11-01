import type {
  FocusLayer,
  FocusNode,
  FocusRegion,
  NavigationDebugSnapshot,
  NavigationService,
} from "../services/navigation.service";

export interface NavigationStoreSnapshot {
  currentFocusId: string | null;
  structureVersion: number;
  nodes: FocusNode[];
  regions: FocusRegion[];
  layers: FocusLayer[];
  debugSnapshot: NavigationDebugSnapshot;
}

export function getNavigationSnapshot(
  source: NavigationService,
  previous?: NavigationStoreSnapshot
): NavigationStoreSnapshot {
  const structureVersion = source.getStructureVersion();

  if (previous?.structureVersion === structureVersion) {
    return {
      ...previous,
      currentFocusId: source.getCurrentFocusId(),
      debugSnapshot: source.getDebugSnapshot(),
    };
  }

  return {
    currentFocusId: source.getCurrentFocusId(),
    structureVersion,
    nodes: source.getNodes(),
    regions: source.getRegions(),
    layers: source.getLayers(),
    debugSnapshot: source.getDebugSnapshot(),
  };
}
