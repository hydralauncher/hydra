import type { GameShop } from "@types";
export type MacCompatibilityPlatform = "macos";
export type MacArchitecture = "arm64" | "x64" | "unknown";
export type MacCompatibilityStatus =
  | "unknown"
  | "checking"
  | "ready"
  | "needs_setup"
  | "needs_repair"
  | "unsupported"
  | "error";
export type MacCompatibilityLevel =
  | "native"
  | "excellent"
  | "good"
  | "fair"
  | "poor"
  | "unsupported"
  | "unknown";
export type MacWineType =
  | "wine"
  | "wine-staging"
  | "wine-crossover"
  | "proton"
  | "proton-ge"
  | "unknown";
export type MacCompatibilityAction =
  | "test"
  | "repair"
  | "create-environment"
  | "change-wine"
  | "install-component";
export interface MacSystemInfo {
  platform: MacCompatibilityPlatform;
  architecture: MacArchitecture;
  osVersion: string;
  computerName: string;
  isAppleSilicon: boolean;
  isIntel: boolean;
  memoryBytes: number;
  availableDiskBytes: number;
  wineAvailable: boolean;
  protonAvailable: boolean;
  rosettaAvailable: boolean;
}
export interface MacWineVersion {
  id: string;
  name: string;
  version: string;
  type: MacWineType;
  executablePath: string;
  isInstalled: boolean;
  isRecommended: boolean;
  architecture: MacArchitecture | "universal";
}
export interface MacWineEnvironment {
  id: string;
  prefixPath: string;
  wineVersionId: string | null;
  wineVersionName: string | null;
  architecture: MacArchitecture;
  exists: boolean;
  initialized: boolean;
  healthy: boolean;
  installedComponents: string[];
  createdAt: string | null;
  updatedAt: string | null;
}
export interface MacGameCompatibility {
  shop: GameShop;
  objectId: string;
  title: string;
  status: MacCompatibilityStatus;
  level: MacCompatibilityLevel;
  score: number | null;
  isWindowsGame: boolean;
  requiresWine: boolean;
  requiresRosetta: boolean;
  recommendedWineVersionId: string | null;
  recommendedWineVersionName: string | null;
  environment: MacWineEnvironment | null;
  issues: MacCompatibilityIssue[];
  recommendations: MacCompatibilityRecommendation[];
}
export interface MacCompatibilityIssue {
  id: string;
  code: string;
  title: string;
  description: string;
  severity: "info" | "warning" | "error";
  fixable: boolean;
  action: MacCompatibilityAction | null;
}
export interface MacCompatibilityRecommendation {
  id: string;
  title: string;
  description: string;
  action: MacCompatibilityAction | null;
  priority: "low" | "medium" | "high";
}
export interface MacCompatibilityCheckResult {
  status: MacCompatibilityStatus;
  issues: MacCompatibilityIssue[];
  recommendations: MacCompatibilityRecommendation[];
  checkedAt: string;
}
export interface MacCompatibilityOperationProgress {
  operationId: string;
  action: MacCompatibilityAction;
  status:
    | "starting"
    | "checking"
    | "installing"
    | "configuring"
    | "testing"
    | "repairing"
    | "complete"
    | "error";
  percent: number;
  message: string;
  detail: string | null;
}
export interface MacCompatibilityOperationResult {
  operationId: string;
  success: boolean;
  status: MacCompatibilityStatus;
  message: string;
  environment: MacWineEnvironment | null;
  issues: MacCompatibilityIssue[];
}
export interface MacCompatibilityGameKey {
  shop: GameShop;
  objectId: string;
}
export interface MacCompatibilityRegistryEntry {
  key: MacCompatibilityGameKey;
  environment: MacWineEnvironment | null;
  selectedWineVersionId: string | null;
  lastStatus: MacCompatibilityStatus;
  lastCheckedAt: string | null;
  updatedAt: string;
}
