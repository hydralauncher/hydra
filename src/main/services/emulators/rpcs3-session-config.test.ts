import assert from "node:assert/strict";
import { it } from "node:test";
import YAML from "yaml";

import { buildRpcs3SessionConfig } from "./rpcs3-session-config.js";

const GLOBAL_CONFIG = `Core:
  PPU Decoder: Recompiler (LLVM)
  SPU Threads: 0
  SPU LLVM Upper Bound: 18446744073709551615
  Use LLVM CPU: ""
Video:
  Renderer: Vulkan
  Vulkan:
    Exclusive Fullscreen Mode: Automatic
    Asynchronous Texture Streaming: false
Audio:
  Microphone Type: "Null"
System:
  Console PSID: 0xF766E9C26BD8143DA8EFB363562B94F7
`;

const CUSTOM_CONFIG = `Core:
  SPU Threads: 2
Video:
  Resolution Scale: 200
`;

it("layers the per-game config over the global one and disables exclusive fullscreen", () => {
  const sessionConfig = buildRpcs3SessionConfig(GLOBAL_CONFIG, CUSTOM_CONFIG);

  assert.deepEqual(YAML.parse(sessionConfig ?? "", { schema: "failsafe" }), {
    Core: {
      "PPU Decoder": "Recompiler (LLVM)",
      "SPU Threads": "2",
      "SPU LLVM Upper Bound": "18446744073709551615",
      "Use LLVM CPU": "",
    },
    Video: {
      Renderer: "Vulkan",
      "Resolution Scale": "200",
      Vulkan: {
        "Exclusive Fullscreen Mode": "Disable",
        "Asynchronous Texture Streaming": "false",
      },
    },
    Audio: { "Microphone Type": "Null" },
    System: { "Console PSID": "0xF766E9C26BD8143DA8EFB363562B94F7" },
  });
});

it("keeps quoted values quoted so RPCS3 does not read them as null", () => {
  const sessionConfig = buildRpcs3SessionConfig(GLOBAL_CONFIG, null) ?? "";

  assert.match(sessionConfig, /Microphone Type: "Null"/);
  assert.match(sessionConfig, /Use LLVM CPU: ""/);
  assert.match(sessionConfig, /SPU LLVM Upper Bound: 18446744073709551615/);
});

it("builds the override when there is no config file", () => {
  assert.deepEqual(YAML.parse(buildRpcs3SessionConfig(null, null) ?? ""), {
    Video: { Vulkan: { "Exclusive Fullscreen Mode": "Disable" } },
  });
});

it("skips the session config when exclusive fullscreen is already disabled", () => {
  assert.equal(
    buildRpcs3SessionConfig(
      GLOBAL_CONFIG,
      "Video:\n  Vulkan:\n    Exclusive Fullscreen Mode: Disable\n"
    ),
    null
  );
});

it("skips the session config when a config file cannot be parsed", () => {
  assert.equal(buildRpcs3SessionConfig("Core: [unclosed", null), null);
});
