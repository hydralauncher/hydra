import assert from "node:assert/strict";
import { it } from "node:test";
import type { EmulatorSaveLocationStatus } from "@types";

import { getEmulatorSaveLocationChoices } from "./emulator-save-location-choices.js";

const status = (
  overrides: Partial<EmulatorSaveLocationStatus> = {}
): EmulatorSaveLocationStatus => ({
  status: "ambiguous",
  selectedRoot: null,
  resolvedRoot: null,
  candidates: ["/home/user/.config/rpcs3", "/home/user/.var/app/rpcs3"],
  ...overrides,
});

it("lists detected folders without selecting one in an ambiguous installation", () => {
  assert.deepEqual(getEmulatorSaveLocationChoices(status()), {
    selectedRoot: "",
    roots: ["/home/user/.config/rpcs3", "/home/user/.var/app/rpcs3"],
  });
});

it("shows the resolved folder for a single detected installation", () => {
  assert.deepEqual(
    getEmulatorSaveLocationChoices(
      status({
        status: "ready",
        resolvedRoot: "/home/user/.config/rpcs3",
        candidates: ["/home/user/.config/rpcs3"],
      })
    ),
    {
      selectedRoot: "/home/user/.config/rpcs3",
      roots: ["/home/user/.config/rpcs3"],
    }
  );
});

it("keeps a manually chosen or invalid folder visible beside detected folders", () => {
  for (const state of ["ready", "invalid-selection"] as const) {
    assert.deepEqual(
      getEmulatorSaveLocationChoices(
        status({ status: state, selectedRoot: "/custom/rpcs3" })
      ),
      {
        selectedRoot: "/custom/rpcs3",
        roots: [
          "/home/user/.config/rpcs3",
          "/home/user/.var/app/rpcs3",
          "/custom/rpcs3",
        ],
      }
    );
  }
});

it("does not duplicate a selected detected folder and handles no candidates", () => {
  assert.equal(
    getEmulatorSaveLocationChoices(
      status({ selectedRoot: "/home/user/.config/rpcs3" })
    ).roots.length,
    2
  );
  assert.deepEqual(getEmulatorSaveLocationChoices(null), {
    selectedRoot: "",
    roots: [],
  });
});
