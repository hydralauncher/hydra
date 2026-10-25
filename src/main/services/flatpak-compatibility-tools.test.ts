import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { findFlatpakCompatibilityTools } from "./flatpak-compatibility-tools.js";

const isValidTool = (toolPath: string) =>
  fs.existsSync(path.join(toolPath, "proton")) &&
  fs.existsSync(path.join(toolPath, "toolmanifest.vdf"));

const createTool = async (
  installationRoot: string,
  extension: string,
  branch: string,
  files: Record<string, string>
) => {
  const deployPath = path.join(
    installationRoot,
    "runtime",
    extension,
    "x86_64",
    branch,
    "0123abcd"
  );
  const toolPath = path.join(deployPath, "files");
  await fs.promises.mkdir(toolPath, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await fs.promises.writeFile(path.join(toolPath, name), content);
  }
  await fs.promises.cp(
    deployPath,
    path.join(path.dirname(deployPath), "active"),
    { recursive: true }
  );
};

describe("Flatpak compatibility tools", () => {
  it("finds Proton add-ons in system and user Flatpak installations", async () => {
    const root = await fs.promises.realpath(
      await fs.promises.mkdtemp(path.join(os.tmpdir(), "hydra-flatpak-"))
    );
    const system = path.join(root, "system");
    const user = path.join(root, "user");
    try {
      await createTool(
        system,
        "com.valvesoftware.Steam.CompatibilityTool.Proton-GE",
        "stable",
        {
          proton: "",
          "toolmanifest.vdf": "",
          "compatibilitytool.vdf":
            '"compatibilitytools" { "compat_tools" { "GE-Proton (Flatpak)" { "display_name" "GE-Proton11-7 (Flatpak)" } } }',
        }
      );
      await createTool(
        user,
        "com.valvesoftware.Steam.CompatibilityTool.Proton",
        "beta",
        { proton: "", "toolmanifest.vdf": "" }
      );
      await createTool(
        user,
        "com.valvesoftware.Steam.CompatibilityTool.Boxtron",
        "stable",
        { "toolmanifest.vdf": "" }
      );
      await createTool(user, "org.freedesktop.Platform.GL.default", "stable", {
        proton: "",
        "toolmanifest.vdf": "",
      });

      const tools = await findFlatpakCompatibilityTools(
        [system, user, path.join(root, "missing")],
        isValidTool
      );

      assert.deepEqual(
        tools.map((tool) => tool.name),
        ["GE-Proton11-7 (Flatpak)", "Proton (Flatpak beta)"]
      );
      assert.ok(
        tools.every((tool) => fs.existsSync(path.join(tool.path, "proton")))
      );
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });
});
