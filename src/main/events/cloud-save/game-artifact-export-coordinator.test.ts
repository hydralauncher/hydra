import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import * as coordinatorModule from "./game-artifact-export-coordinator.ts";

const { GameArtifactExportCoordinator } = coordinatorModule;

describe("game artifact export coordinator", () => {
  it("does not cancel when there is no active export", () => {
    const coordinator = new GameArtifactExportCoordinator();

    assert.equal(coordinator.cancel(1), false);
  });

  it("allows only one active export", () => {
    const coordinator = new GameArtifactExportCoordinator();
    const first = coordinator.start(1);

    assert.ok(first);
    assert.equal(coordinator.start(1), null);
    assert.equal(coordinator.start(2), null);
  });

  it("only lets the initiating sender cancel the export", () => {
    const coordinator = new GameArtifactExportCoordinator();
    const controller = coordinator.start(1);

    assert.ok(controller);
    assert.equal(coordinator.cancel(2), false);
    assert.equal(controller.signal.aborted, false);
    assert.equal(coordinator.cancel(1), true);
    assert.equal(controller.signal.aborted, true);
  });

  it("keeps the lock until the active export finishes", () => {
    const coordinator = new GameArtifactExportCoordinator();
    const controller = coordinator.start(1);

    assert.ok(controller);
    coordinator.cancel(1);
    assert.equal(coordinator.start(2), null);

    coordinator.finish(new AbortController());
    assert.equal(coordinator.start(2), null);

    coordinator.finish(controller);
    assert.ok(coordinator.start(2));
  });
});
