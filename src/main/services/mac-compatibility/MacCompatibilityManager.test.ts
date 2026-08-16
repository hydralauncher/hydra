import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import { MacCompatibilityManager } from "./MacCompatibilityManager.ts";
// @ts-ignore The Node ESM test runner requires the source extension.
import type {
  MacCompatibilityGameKey,
  MacCompatibilityStatus,
  MacSystemInfo,
  MacWineEnvironment,
  MacWineVersion,
} from "./MacCompatibilityTypes.ts";
// @ts-ignore The Node ESM test runner requires the source extension.
import type { MacCompatibilityRegistry } from "./MacCompatibilityRegistry.ts";
// @ts-ignore The Node ESM test runner requires the source extension.
import type { MacSystemDetector } from "./MacSystemDetector.ts";
// @ts-ignore The Node ESM test runner requires the source extension.
import type { MacWineDetector } from "./MacWineDetector.ts";
// @ts-ignore The Node ESM test runner requires the source extension.
import type {
  MacWineEnvironmentManager,
  MacWineEnvironmentRepairer,
} from "./environment/index.ts";
// @ts-ignore The Node ESM test runner requires the source extension.
import type { MacWineEnvironmentRepairResult } from "./environment/MacWineEnvironmentRepairer.ts";
// @ts-ignore The Node ESM test runner requires the source extension.
import type { MacWineEnvironmentHealthResult } from "./environment/MacWineEnvironmentHealthChecker.ts";

const GAME: MacCompatibilityGameKey = { shop: "steam", objectId: "1091500" };

const SYSTEM_INFO: MacSystemInfo = {
  platform: "macos",
  architecture: "arm64",
  osVersion: "14.5",
  computerName: "Test Mac",
  isAppleSilicon: true,
  isIntel: false,
  memoryBytes: 17_179_869_184,
  availableDiskBytes: 107_374_182_400,
  wineAvailable: true,
  protonAvailable: false,
  rosettaAvailable: true,
};

const RECOMMENDED_WINE: MacWineVersion = {
  id: "homebrew-wine-arm64",
  name: "Wine (Homebrew, Apple Silicon)",
  version: "wine-9.0",
  type: "wine",
  executablePath: "/opt/homebrew/bin/wine64",
  isInstalled: true,
  isRecommended: true,
  architecture: "arm64",
};

const makeEnvironment = (
  overrides: Partial<MacWineEnvironment> = {}
): MacWineEnvironment => ({
  id: "env-1",
  prefixPath: "/tmp/hydra-mac-env/env-1",
  wineVersionId: RECOMMENDED_WINE.id,
  wineVersionName: RECOMMENDED_WINE.name,
  architecture: "arm64",
  exists: true,
  initialized: true,
  healthy: true,
  installedComponents: ["wine-prefix"],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

/**
 * Records every status the manager ever reports, without reimplementing
 * any of the manager's own decision logic. Backed by a plain object, not
 * MacCompatibilityRegistry, so tests never touch disk.
 */
class FakeRegistry {
  public statusCalls: Array<{
    game: MacCompatibilityGameKey;
    status: MacCompatibilityStatus;
  }> = [];
  public wineVersionCalls: Array<{
    game: MacCompatibilityGameKey;
    wineVersionId: string | null;
  }> = [];
  public environmentCalls: Array<{
    game: MacCompatibilityGameKey;
    environment: MacWineEnvironment | null;
  }> = [];

  setStatus(game: MacCompatibilityGameKey, status: MacCompatibilityStatus) {
    this.statusCalls.push({ game, status });
  }

  setWineVersion(game: MacCompatibilityGameKey, wineVersionId: string | null) {
    this.wineVersionCalls.push({ game, wineVersionId });
  }

  setEnvironment(
    game: MacCompatibilityGameKey,
    environment: MacWineEnvironment | null
  ) {
    this.environmentCalls.push({ game, environment });
  }

  get lastStatus(): MacCompatibilityStatus | null {
    return this.statusCalls.at(-1)?.status ?? null;
  }
}

class FakeSystemDetector {
  constructor(private readonly systemInfo: MacSystemInfo = SYSTEM_INFO) {}

  async detect(): Promise<MacSystemInfo> {
    return this.systemInfo;
  }
}

class FakeWineDetector {
  constructor(private readonly versions: MacWineVersion[]) {}

  async detectInstalledVersions(): Promise<MacWineVersion[]> {
    return this.versions;
  }

  async isWineAvailable(): Promise<boolean> {
    return this.versions.length > 0;
  }
}

class FakeEnvironmentManager {
  public createEnvironmentCalls = 0;
  public checkEnvironmentHealthCalls = 0;
  public deleteEnvironmentCalls = 0;

  constructor(
    private environment: MacWineEnvironment | null,
    private readonly healthOnCheck: MacWineEnvironmentHealthResult = {
      healthy: true,
      initialized: true,
      message: "ok",
    }
  ) {}

  async getEnvironment(): Promise<MacWineEnvironment | null> {
    return this.environment;
  }

  async refreshEnvironmentPresence(): Promise<MacWineEnvironment | null> {
    return this.environment;
  }

  async createEnvironment(
    _game: MacCompatibilityGameKey,
    wineVersion: MacWineVersion
  ): Promise<MacWineEnvironment> {
    this.createEnvironmentCalls += 1;
    this.environment = makeEnvironment({
      wineVersionId: wineVersion.id,
      wineVersionName: wineVersion.name,
    });
    return this.environment;
  }

  async checkEnvironmentHealth(): Promise<{
    environment: MacWineEnvironment | null;
    health: MacWineEnvironmentHealthResult;
  }> {
    this.checkEnvironmentHealthCalls += 1;

    if (!this.environment) {
      return {
        environment: null,
        health: {
          healthy: false,
          initialized: false,
          message: "No Wine environment exists for this game.",
        },
      };
    }

    this.environment = {
      ...this.environment,
      healthy: this.healthOnCheck.healthy,
      initialized: this.healthOnCheck.initialized,
    };

    return { environment: this.environment, health: this.healthOnCheck };
  }

  async deleteEnvironment(): Promise<boolean> {
    this.deleteEnvironmentCalls += 1;

    if (!this.environment) {
      return false;
    }

    this.environment = null;
    return true;
  }
}

class FakeEnvironmentRepairer {
  constructor(private readonly result: MacWineEnvironmentRepairResult) {}

  async repair(): Promise<MacWineEnvironmentRepairResult> {
    return this.result;
  }
}

const buildManager = (options: {
  environment?: MacWineEnvironment | null;
  wineVersions?: MacWineVersion[];
  healthOnCheck?: MacWineEnvironmentHealthResult;
  repairResult?: MacWineEnvironmentRepairResult;
}) => {
  const registry = new FakeRegistry();
  const environmentManager = new FakeEnvironmentManager(
    options.environment ?? null,
    options.healthOnCheck
  );
  const environmentRepairer = new FakeEnvironmentRepairer(
    options.repairResult ?? {
      success: true,
      environment: options.environment ?? makeEnvironment(),
      message: "repaired",
    }
  );

  const manager = new MacCompatibilityManager({
    systemDetector: new FakeSystemDetector() as unknown as MacSystemDetector,
    wineDetector: new FakeWineDetector(
      options.wineVersions ?? []
    ) as unknown as MacWineDetector,
    registry: registry as unknown as MacCompatibilityRegistry,
    environmentManager:
      environmentManager as unknown as MacWineEnvironmentManager,
    environmentRepairer:
      environmentRepairer as unknown as MacWineEnvironmentRepairer,
  });

  return { manager, registry, environmentManager, environmentRepairer };
};

describe("MacCompatibilityManager.checkGame status", () => {
  it("no environment + no recommended Wine -> needs_setup", async () => {
    const { manager } = buildManager({ environment: null, wineVersions: [] });

    const result = await manager.checkGame(GAME, "Test Game", true);

    assert.equal(result.status, "needs_setup");
  });

  it("no environment + recommended Wine -> needs_setup", async () => {
    const { manager } = buildManager({
      environment: null,
      wineVersions: [RECOMMENDED_WINE],
    });

    const result = await manager.checkGame(GAME, "Test Game", true);

    assert.equal(result.status, "needs_setup");
  });

  it("healthy environment + no recommended Wine -> ready", async () => {
    const { manager } = buildManager({
      environment: makeEnvironment({ healthy: true }),
      wineVersions: [],
    });

    const result = await manager.checkGame(GAME, "Test Game", true);

    assert.equal(result.status, "ready");
  });

  it("healthy environment + recommended Wine -> ready", async () => {
    const { manager } = buildManager({
      environment: makeEnvironment({ healthy: true }),
      wineVersions: [RECOMMENDED_WINE],
    });

    const result = await manager.checkGame(GAME, "Test Game", true);

    assert.equal(result.status, "ready");
  });

  it("unhealthy environment + no recommended Wine -> needs_repair", async () => {
    const { manager } = buildManager({
      environment: makeEnvironment({ healthy: false }),
      wineVersions: [],
    });

    const result = await manager.checkGame(GAME, "Test Game", true);

    assert.equal(result.status, "needs_repair");
  });

  /**
   * The adversarial case: a recommended Wine version being installed
   * must never mask an existing unhealthy environment. This is the
   * exact scenario that produced needs_setup instead of needs_repair
   * before the fix — deleting the `environment && !environment.healthy`
   * branch in MacCompatibilityManager.checkGame() makes this test fail
   * again.
   */
  it("unhealthy environment + recommended Wine -> needs_repair", async () => {
    const { manager } = buildManager({
      environment: makeEnvironment({ healthy: false }),
      wineVersions: [RECOMMENDED_WINE],
    });

    const result = await manager.checkGame(GAME, "Test Game", true);

    assert.equal(result.status, "needs_repair");
  });

  it("reports an unhealthy environment as fixable via repair", async () => {
    const { manager } = buildManager({
      environment: makeEnvironment({ healthy: false }),
      wineVersions: [RECOMMENDED_WINE],
    });

    const result = await manager.checkGame(GAME, "Test Game", true);

    const unhealthyIssue = result.issues.find(
      (issue) => issue.code === "ENVIRONMENT_UNHEALTHY"
    );

    assert.ok(unhealthyIssue, "expected an ENVIRONMENT_UNHEALTHY issue");
    assert.equal(unhealthyIssue?.action, "repair");
  });

  it("a native (non-Windows) game is always ready and needs no Wine", async () => {
    const { manager, environmentManager } = buildManager({
      environment: makeEnvironment({ healthy: false }),
      wineVersions: [],
    });

    const result = await manager.checkGame(GAME, "Test Game", false);

    assert.equal(result.status, "ready");
    assert.equal(result.requiresWine, false);
    // The environment must never even be consulted for a native game.
    assert.equal(environmentManager.checkEnvironmentHealthCalls, 0);
  });
});

describe("MacCompatibilityManager lifecycle", () => {
  it("createGameEnvironment creates an environment and marks the game ready", async () => {
    const { manager, registry, environmentManager } = buildManager({
      environment: null,
      wineVersions: [RECOMMENDED_WINE],
    });

    const environment = await manager.createGameEnvironment(GAME);

    assert.equal(environmentManager.createEnvironmentCalls, 1);
    assert.equal(environment.wineVersionId, RECOMMENDED_WINE.id);
    assert.equal(registry.lastStatus, "ready");
  });

  it("createGameEnvironment throws when no Wine is installed", async () => {
    const { manager } = buildManager({ environment: null, wineVersions: [] });

    await assert.rejects(() => manager.createGameEnvironment(GAME));
  });

  it("testGameEnvironment returns true and marks ready when the environment is healthy", async () => {
    const { manager, registry } = buildManager({
      environment: makeEnvironment(),
      wineVersions: [RECOMMENDED_WINE],
      healthOnCheck: { healthy: true, initialized: true, message: "ok" },
    });

    const healthy = await manager.testGameEnvironment(GAME);

    assert.equal(healthy, true);
    assert.equal(registry.lastStatus, "ready");
  });

  it("testGameEnvironment returns false and marks needs_repair when the environment is unhealthy", async () => {
    const { manager, registry } = buildManager({
      environment: makeEnvironment(),
      wineVersions: [RECOMMENDED_WINE],
      healthOnCheck: {
        healthy: false,
        initialized: true,
        message: "broken prefix",
      },
    });

    const healthy = await manager.testGameEnvironment(GAME);

    assert.equal(healthy, false);
    assert.equal(registry.lastStatus, "needs_repair");
  });

  it("testGameEnvironment marks needs_setup when there is no environment yet", async () => {
    const { manager, registry } = buildManager({
      environment: null,
      wineVersions: [RECOMMENDED_WINE],
    });

    const healthy = await manager.testGameEnvironment(GAME);

    assert.equal(healthy, false);
    assert.equal(registry.lastStatus, "needs_setup");
  });

  it("repairGameEnvironment marks ready on a successful, verified repair", async () => {
    const { manager, registry } = buildManager({
      environment: makeEnvironment({ healthy: false }),
      wineVersions: [RECOMMENDED_WINE],
      healthOnCheck: { healthy: true, initialized: true, message: "ok" },
      repairResult: {
        success: true,
        environment: makeEnvironment({ healthy: true }),
        message: "repaired",
      },
    });

    const environment = await manager.repairGameEnvironment(GAME);

    assert.equal(environment.healthy, true);
    assert.equal(registry.lastStatus, "ready");
  });

  it("repairGameEnvironment throws and marks needs_repair when the repair itself fails", async () => {
    const { manager, registry } = buildManager({
      environment: makeEnvironment({ healthy: false }),
      wineVersions: [RECOMMENDED_WINE],
      repairResult: {
        success: false,
        environment: makeEnvironment({ healthy: false }),
        message: "wineboot failed",
      },
    });

    await assert.rejects(
      () => manager.repairGameEnvironment(GAME),
      /wineboot failed/
    );
    assert.equal(registry.lastStatus, "needs_repair");
  });

  it("repairGameEnvironment throws and marks needs_repair when the repair reports success but re-verification still fails", async () => {
    const { manager, registry } = buildManager({
      environment: makeEnvironment({ healthy: false }),
      wineVersions: [RECOMMENDED_WINE],
      healthOnCheck: {
        healthy: false,
        initialized: true,
        message: "still broken after repair",
      },
      repairResult: {
        success: true,
        environment: makeEnvironment({ healthy: false }),
        message: "repaired",
      },
    });

    await assert.rejects(
      () => manager.repairGameEnvironment(GAME),
      /still broken after repair/
    );
    assert.equal(registry.lastStatus, "needs_repair");
  });

  it("deleteGameEnvironment clears the environment and marks needs_setup", async () => {
    const { manager, registry } = buildManager({
      environment: makeEnvironment(),
      wineVersions: [RECOMMENDED_WINE],
    });

    const deleted = await manager.deleteGameEnvironment(GAME);

    assert.equal(deleted, true);
    assert.equal(registry.lastStatus, "needs_setup");
  });

  it("deleteGameEnvironment returns false when there was nothing to delete", async () => {
    const { manager, registry } = buildManager({
      environment: null,
      wineVersions: [],
    });

    const deleted = await manager.deleteGameEnvironment(GAME);

    assert.equal(deleted, false);
    assert.equal(registry.statusCalls.length, 0);
  });
});

describe("MacCompatibilityManager constructor", () => {
  it("constructs with no arguments using the real default dependencies", () => {
    // This is the core DI regression check: the zero-arg constructor
    // must keep working exactly as it did before dependency injection
    // was added, wiring up the real system/wine detectors, registry,
    // and environment manager/repairer with no fakes involved.
    assert.doesNotThrow(() => new MacCompatibilityManager());
  });

  it("uses an injected dependency instead of constructing a real one", async () => {
    let detectCalls = 0;

    const fakeSystemDetector = {
      detect: async () => {
        detectCalls += 1;
        return SYSTEM_INFO;
      },
    } as unknown as MacSystemDetector;

    const manager = new MacCompatibilityManager({
      systemDetector: fakeSystemDetector,
      wineDetector: new FakeWineDetector([]) as unknown as MacWineDetector,
      registry: new FakeRegistry() as unknown as MacCompatibilityRegistry,
      environmentManager: new FakeEnvironmentManager(
        null
      ) as unknown as MacWineEnvironmentManager,
      environmentRepairer: new FakeEnvironmentRepairer({
        success: true,
        environment: makeEnvironment(),
        message: "repaired",
      }) as unknown as MacWineEnvironmentRepairer,
    });

    const info = await manager.getSystemInfo();

    assert.equal(detectCalls, 1);
    assert.deepEqual(info, SYSTEM_INFO);
  });
});
