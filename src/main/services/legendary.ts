import { app } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import manifest from "../../shared/legendary-manifest.json";
import { EpicIntegrationError } from "./epic/auth-protocol";
import type { EpicManagedCommand } from "./epic/target-runtime";

export class Legendary {
  private static managedCommand: Promise<EpicManagedCommand> | undefined;
  public static async getManagedCommand(): Promise<EpicManagedCommand> {
    if (!this.managedCommand) {
      this.managedCommand = this.resolveManagedCommand().catch((error) => {
        this.managedCommand = undefined;
        throw error;
      });
    }
    return this.managedCommand;
  }
  private static async resolveManagedCommand(): Promise<EpicManagedCommand> {
    const original = this.getBinaryPath();
    if (!original || !["win32", "linux"].includes(process.platform))
      throw new EpicIntegrationError("legendary-unavailable");
    const root = path.dirname(original);
    const index = JSON.parse(
      await fs.readFile(path.join(root, "managed-runtime.json"), "utf8")
    );
    if (
      index.protocolVersion !== manifest.managedRuntime.protocolVersion ||
      index.legendaryVersion !== manifest.version ||
      !Array.isArray(index.capabilities) ||
      !manifest.managedRuntime.capabilities.every((capability) =>
        index.capabilities.includes(capability)
      )
    )
      throw new EpicIntegrationError("legendary-unavailable");
    const script = path.join(root, "managed.py");
    const archive = path.join(root, "managed-legendary.pyz");
    const expectedArchive =
      manifest.artifacts.linux[process.arch as "x64" | "arm64"]?.sha256;
    for (const [file, expected] of [
      [script, manifest.managedRuntime.adapterSha256],
      [archive, expectedArchive],
    ]) {
      const stat = await fs.lstat(file!);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        createHash("sha256")
          .update(await fs.readFile(file!))
          .digest("hex") !== expected
      )
        throw new EpicIntegrationError("legendary-unavailable");
    }
    const binary =
      process.platform === "win32"
        ? path.join(root, "python", "python.exe")
        : path.join(root, "python-runner");
    if (!(await fs.stat(binary)).isFile())
      throw new EpicIntegrationError("legendary-unavailable");
    return {
      binary,
      prefixArgs: [
        ...(process.platform === "win32" ? ["-I", "-B"] : []),
        script,
        archive,
      ],
    };
  }
  public static getBinaryPath() {
    if (!["linux", "win32", "darwin"].includes(process.platform)) return null;
    if (process.arch !== "x64" && process.arch !== "arm64") return null;
    const binary = process.platform === "win32" ? "legendary.exe" : "legendary";
    return app.isPackaged
      ? path.join(process.resourcesPath, "legendary", binary)
      : path.join(
          __dirname,
          "..",
          "..",
          "legendary",
          process.platform,
          process.arch,
          binary
        );
  }
}
