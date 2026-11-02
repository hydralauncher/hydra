import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";

import { requireRetroArchExecutablePath } from "./retroarch-executable-guard.js";

it("blocks RetroArch sync before save materialization when the executable is unavailable", () => {
  const root = mkdtempSync(path.join(tmpdir(), "hydra-retroarch-executable-"));
  const executablePath = path.join(root, "retroarch");

  try {
    assert.throws(
      () => requireRetroArchExecutablePath(null),
      /cloud_save_retroarch_not_configured/
    );
    assert.throws(
      () => requireRetroArchExecutablePath(executablePath),
      /cloud_save_retroarch_executable_missing/
    );

    writeFileSync(executablePath, "");
    assert.equal(
      requireRetroArchExecutablePath(executablePath),
      executablePath
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
