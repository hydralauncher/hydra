export { MacCompatibilityManager } from "./MacCompatibilityManager.js";
export { MacCompatibilityRegistry } from "./MacCompatibilityRegistry.js";
export { MacGameManager } from "./MacGameManager.js";
export { MacSystemDetector } from "./MacSystemDetector.js";
export { MacWineDetector } from "./MacWineDetector.js";

export {
  MacGameLaunchController,
  MacGameLaunchManager,
  type MacGameLaunchRequest,
  type MacGameLaunchResult,
} from "./launch/index.js";

export {
  MacWineEnvironmentHealthChecker,
  MacWineEnvironmentInitializer,
  MacWineEnvironmentManager,
  MacWineEnvironmentRegistry,
  MacWineEnvironmentRepairer,
} from "./environment/index.js";

export type {
  MacArchitecture,
  MacCompatibilityAction,
  MacCompatibilityCheckResult,
  MacCompatibilityGameKey,
  MacCompatibilityIssue,
  MacCompatibilityLevel,
  MacCompatibilityOperationProgress,
  MacCompatibilityOperationResult,
  MacCompatibilityPlatform,
  MacCompatibilityRecommendation,
  MacCompatibilityRegistryEntry,
  MacCompatibilityStatus,
  MacGameCompatibility,
  MacSystemInfo,
  MacWineEnvironment,
  MacWineType,
  MacWineVersion,
} from "./MacCompatibilityTypes.js";
