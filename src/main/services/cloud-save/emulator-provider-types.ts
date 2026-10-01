import type {
  CloudSaveRule,
  CloudSaveStateMetadata,
  Game,
  LocalResolutionBindings,
  RestoreManifestFile,
  UserLocationCoverage,
} from "@types";

export interface EmulatorDiscoveredFile {
  variantId: string;
  ruleId: string;
  rawPath: string;
  absolutePath: string;
  relativePath: string;
  localBindings: LocalResolutionBindings;
  confidence: "exact";
  provenance: string[];
  stateMetadata?: CloudSaveStateMetadata;
}

export interface EmulatorProviderDiscovery {
  files: EmulatorDiscoveredFile[];
  coverage: UserLocationCoverage[];
  revision: string;
}

export interface EmulatorProviderContext {
  game: Game;
  environmentId: string;
  variantId: string;
  remoteFiles?: RestoreManifestFile[];
  rpcs3SavedataTitleIds?: readonly string[];
}

export interface EmulatorProvider {
  discover(
    context: EmulatorProviderContext
  ): Promise<EmulatorProviderDiscovery>;
  restoreRules(
    game: Game,
    files: RestoreManifestFile[],
    rpcs3SavedataTitleIds?: readonly string[]
  ): Promise<Map<string, CloudSaveRule>>;
}
