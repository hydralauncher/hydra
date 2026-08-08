import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import * as operationModule from "./export-game-artifact-operation.ts";

const { exportGameArtifactArchive, sanitizeLegacySaveArchiveName } =
  operationModule;

type Step =
  | "create-temporary-directory"
  | "download"
  | "extract"
  | "zip"
  | "dialog"
  | "copy"
  | "cleanup";

const createDependencies = ({
  destinationPath = "C:\\exports\\save.zip",
  failingStep,
}: {
  destinationPath?: string | null;
  failingStep?: Step;
} = {}) => {
  const calls: Step[] = [];
  const runStep = (step: Step) => {
    calls.push(step);
    if (step === failingStep) throw new Error(`${step} failed`);
  };

  return {
    calls,
    dependencies: {
      createTemporaryDirectory: async () => {
        runStep("create-temporary-directory");
        return "C:\\temp\\legacy-save";
      },
      downloadTar: async () => runStep("download"),
      extractTar: async () => runStep("extract"),
      createZip: async () => runStep("zip"),
      selectDestination: async () => {
        runStep("dialog");
        return destinationPath;
      },
      copyZip: async () => runStep("copy"),
      cleanupTemporaryDirectory: async () => runStep("cleanup"),
    },
  };
};

describe("legacy save artifact export", () => {
  it("downloads, converts, prompts, copies, and cleans up in order", async () => {
    const { calls, dependencies } = createDependencies();

    assert.deepEqual(await exportGameArtifactArchive(dependencies), {
      status: "saved",
      filePath: "C:\\exports\\save.zip",
    });
    assert.deepEqual(calls, [
      "create-temporary-directory",
      "download",
      "extract",
      "zip",
      "dialog",
      "copy",
      "cleanup",
    ]);
  });

  it("cleans up without copying when the save dialog is cancelled", async () => {
    const { calls, dependencies } = createDependencies({
      destinationPath: null,
    });

    assert.deepEqual(await exportGameArtifactArchive(dependencies), {
      status: "cancelled",
    });
    assert.deepEqual(calls, [
      "create-temporary-directory",
      "download",
      "extract",
      "zip",
      "dialog",
      "cleanup",
    ]);
  });

  for (const failingStep of ["download", "zip", "copy"] as const) {
    it(`cleans up and rejects when ${failingStep} fails`, async () => {
      const { calls, dependencies } = createDependencies({ failingStep });

      await assert.rejects(
        exportGameArtifactArchive(dependencies),
        new Error(`${failingStep} failed`)
      );
      assert.equal(calls.at(-1), "cleanup");
    });
  }

  it("sanitizes the suggested ZIP name and supplies a fallback", () => {
    assert.equal(
      sanitizeLegacySaveArchiveName('  My:Save?/"2026".zip  '),
      "My_Save___2026_"
    );
    assert.equal(
      sanitizeLegacySaveArchiveName("Line one\nLine two..zip"),
      "Line one_Line two"
    );
    assert.equal(sanitizeLegacySaveArchiveName("CON"), "_CON");
    assert.equal(sanitizeLegacySaveArchiveName(".zip"), "legacy-save");
  });
});
