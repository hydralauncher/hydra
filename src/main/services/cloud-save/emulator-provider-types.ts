import type {
  CloudSaveRule,
  CloudSaveStateMetadata,
  Game,
  LocalResolutionBindings,
  ResolvedRestoreTarget,
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
  savedataTitleIds?: readonly string[];
}

export interface EmulatorProvider {
  discover(
    context: EmulatorProviderContext
  ): Promise<EmulatorProviderDiscovery>;
  restoreRules(
    game: Game,
    files: RestoreManifestFile[],
    savedataTitleIds?: readonly string[]
  ): Promise<Map<string, CloudSaveRule>>;
  afterRestore?(actions: ResolvedRestoreTarget[]): Promise<void>;
}
