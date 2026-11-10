import assert from "node:assert/strict";
import { it } from "node:test";

import { disableRpcs3ExclusiveFullscreen } from "./rpcs3-session-config.js";

it("disables exclusive fullscreen while keeping the per-game settings", () => {
  assert.deepEqual(
    disableRpcs3ExclusiveFullscreen({
      Core: { "PPU Decoder": "Recompiler (LLVM)" },
      Video: {
        Renderer: "Vulkan",
        Vulkan: {
          "Exclusive Fullscreen Mode": "Automatic",
          "Asynchronous Texture Streaming": true,
        },
      },
    }),
    {
      Core: { "PPU Decoder": "Recompiler (LLVM)" },
      Video: {
        Renderer: "Vulkan",
        Vulkan: {
          "Exclusive Fullscreen Mode": "Disable",
          "Asynchronous Texture Streaming": true,
        },
      },
    }
  );
});

it("builds the override when no per-game config exists", () => {
  assert.deepEqual(disableRpcs3ExclusiveFullscreen({}), {
    Video: { Vulkan: { "Exclusive Fullscreen Mode": "Disable" } },
  });
});
