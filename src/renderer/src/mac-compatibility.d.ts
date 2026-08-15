/**
 * Types for the `window.macCompatibility` bridge created in
 * src/preload/mac-compatibility.ts.
 *
 * These describe only the fields the renderer reads. The real objects come
 * from src/main/services/mac-compatibility/MacCompatibilityTypes.ts and may
 * contain more fields than the ones listed here.
 */
declare global {
  type MacCompatibilityStatusValue =
    | "unknown"
    | "checking"
    | "ready"
    | "needs_setup"
    | "needs_repair"
    | "unsupported"
    | "error";

  interface MacSystemInfoView {
    architecture: "arm64" | "x64" | "unknown";
    osVersion: string;
    isAppleSilicon: boolean;
    isIntel: boolean;
    rosettaAvailable: boolean;
    wineAvailable: boolean;
  }

  interface MacWineVersionView {
    id: string;
    name: string;
    version: string;
    isRecommended: boolean;
  }

  interface MacWineEnvironmentView {
    id: string;
    prefixPath: string;
    wineVersionId: string | null;
    wineVersionName: string | null;
    exists: boolean;
    initialized: boolean;
    healthy: boolean;
  }

  interface MacCompatibilityIssueView {
    id: string;
    title: string;
    description: string;
    severity: "info" | "warning" | "error";
  }

  interface MacGameCompatibilityView {
    title: string;
    status: MacCompatibilityStatusValue;
    isWindowsGame: boolean;
    requiresWine: boolean;
    requiresRosetta: boolean;
    recommendedWineVersionName: string | null;
    environment: MacWineEnvironmentView | null;
    issues: MacCompatibilityIssueView[];
  }

  interface MacCompatibilityActionResultView {
    success: boolean;
    status: MacCompatibilityStatusValue;
    message: string;
    environment: MacWineEnvironmentView | null;
  }

  interface MacCompatibilityBridge {
    getSystemInfo: () => Promise<MacSystemInfoView | null>;
    getWineVersions: () => Promise<MacWineVersionView[]>;
    getGameEnvironment: (
      shop: string,
      objectId: string
    ) => Promise<MacWineEnvironmentView | null>;
    checkGame: (
      shop: string,
      objectId: string,
      title: string,
      isWindowsGame: boolean
    ) => Promise<MacGameCompatibilityView | null>;
    createEnvironment: (
      shop: string,
      objectId: string
    ) => Promise<MacCompatibilityActionResultView>;
    testEnvironment: (
      shop: string,
      objectId: string
    ) => Promise<MacCompatibilityActionResultView>;
    repairEnvironment: (
      shop: string,
      objectId: string
    ) => Promise<MacCompatibilityActionResultView>;
    deleteEnvironment: (
      shop: string,
      objectId: string
    ) => Promise<MacCompatibilityActionResultView>;
    fixEverything: (
      shop: string,
      objectId: string,
      isWindowsGame: boolean
    ) => Promise<MacCompatibilityActionResultView>;
  }

  interface Window {
    macCompatibility?: MacCompatibilityBridge;
  }
}

export {};
