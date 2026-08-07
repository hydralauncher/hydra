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
      signal: undefined as AbortSignal | undefined,
      createTemporaryDirectory: async () => {
        runStep("create-temporary-directory");
        return "C:\\temp\\legacy-save";
      },
      downloadTar: async (_destinationPath: string) => runStep("download"),
      extractTar: async (_tarPath: string, _destinationPath: string) =>
        runStep("extract"),
      createZip: async (_sourcePath: string, _destinationPath: string) =>
        runStep("zip"),
      selectDestination: async () => {
        runStep("dialog");
        return destinationPath;
      },
      copyZip: async (_sourcePath: string, _destinationPath: string) =>
        runStep("copy"),
      cleanupTemporaryDirectory: async (_temporaryDirectory: string) =>
        runStep("cleanup"),
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

  it("stops after the download when the export is cancelled", async () => {
    const controller = new AbortController();
    const { calls, dependencies } = createDependencies();
    const originalDownload = dependencies.downloadTar;

    dependencies.signal = controller.signal;
    dependencies.downloadTar = async (destinationPath) => {
      await originalDownload(destinationPath);
      controller.abort();
    };

    await assert.rejects(
      exportGameArtifactArchive(dependencies),
      (error: unknown) => error instanceof Error && error.name === "AbortError"
    );
    assert.deepEqual(calls, [
      "create-temporary-directory",
      "download",
      "cleanup",
    ]);
  });

  it("does not open the destination dialog when ZIP creation is cancelled", async () => {
    const controller = new AbortController();
    const { calls, dependencies } = createDependencies();
    const originalCreateZip = dependencies.createZip;

    dependencies.signal = controller.signal;
    dependencies.createZip = async (sourcePath, destinationPath) => {
      await originalCreateZip(sourcePath, destinationPath);
      controller.abort();
    };

    await assert.rejects(
      exportGameArtifactArchive(dependencies),
      (error: unknown) => error instanceof Error && error.name === "AbortError"
    );
    assert.deepEqual(calls, [
      "create-temporary-directory",
      "download",
      "extract",
      "zip",
      "cleanup",
    ]);
  });

  it("treats the final copy as committed when cancellation arrives during it", async () => {
    const controller = new AbortController();
    const { calls, dependencies } = createDependencies();
    const originalCopyZip = dependencies.copyZip;

    dependencies.signal = controller.signal;
    dependencies.copyZip = async (sourcePath, destinationPath) => {
      await originalCopyZip(sourcePath, destinationPath);
      controller.abort();
    };

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
