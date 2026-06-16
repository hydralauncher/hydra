import assert from "node:assert";
import { describe, it } from "node:test";

import {
  buildWindowsBatchCommand,
  isWindowsBatchFile,
} from "./windows-batch-command.ts";

describe("isWindowsBatchFile", () => {
  it("detects .bat case-insensitively", () => {
    assert.equal(isWindowsBatchFile("C:\\game\\launch.bat"), true);
    assert.equal(isWindowsBatchFile("C:\\game\\LAUNCH.BAT"), true);
  });

  it("ignores non-batch commands, including .cmd", () => {
    assert.equal(isWindowsBatchFile("C:\\game\\game.exe"), false);
    assert.equal(isWindowsBatchFile("C:\\game\\launch.cmd"), false);
    assert.equal(isWindowsBatchFile("gamemoderun"), false);
    assert.equal(isWindowsBatchFile("C:\\game\\notes.bat.txt"), false);
  });
});

describe("buildWindowsBatchCommand", () => {
  it("quotes the command so cmd.exe /s runs it as a single token", () => {
    assert.equal(
      buildWindowsBatchCommand("C:\\game\\launch.bat", []),
      '"C:\\game\\launch.bat"'
    );
  });

  it("quotes a path and args that contain spaces", () => {
    assert.equal(
      buildWindowsBatchCommand("C:\\my games\\launch.bat", ["-foo", "bar baz"]),
      '"C:\\my games\\launch.bat" "-foo" "bar baz"'
    );
  });

  it("doubles embedded quotes", () => {
    assert.equal(
      buildWindowsBatchCommand("C:\\game\\launch.bat", ['say "hi"']),
      '"C:\\game\\launch.bat" "say ""hi"""'
    );
  });
});
