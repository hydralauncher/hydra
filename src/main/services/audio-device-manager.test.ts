import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parsePactlAudioSinks,
  parseWpctlAudioSinks,
} from "./audio-device-manager-utils.ts";

describe("audio device manager utilities", () => {
  it("parses PipeWire sinks from wpctl status", () => {
    const output = `PipeWire 'pipewire-0'

Audio
 ├─ Devices:
 │      51. Built-in Audio                      [alsa]
 │
 ├─ Sinks:
 │  *   52. Built-in Audio Analog Stereo        [vol: 0.40]
 │      74. HDMI / DisplayPort                  [vol: 1.00]
 │
 ├─ Sources:
 │  *   53. Built-in Audio Analog Stereo        [vol: 1.00]
 │
 └─ Streams:
`;

    assert.deepEqual(parseWpctlAudioSinks(output), [
      {
        id: "wpctl:52",
        label: "Built-in Audio Analog Stereo",
        isDefault: true,
      },
      {
        id: "wpctl:74",
        label: "HDMI / DisplayPort",
        isDefault: false,
      },
    ]);
  });

  it("parses PulseAudio-compatible sinks with friendly descriptions", () => {
    const output = `Sink #52
\tState: SUSPENDED
\tName: alsa_output.pci-0000_00_05.0.analog-stereo
\tDescription: Built-in Audio Analog Stereo
\tDriver: PipeWire

Sink #120
\tState: SUSPENDED
\tName: hydra_test_output
\tDescription: Hydra Test Output
\tDriver: PipeWire
`;

    assert.deepEqual(
      parsePactlAudioSinks(
        output,
        "alsa_output.pci-0000_00_05.0.analog-stereo"
      ),
      [
        {
          id: "pactl:alsa_output.pci-0000_00_05.0.analog-stereo",
          label: "Built-in Audio Analog Stereo",
          isDefault: true,
        },
        {
          id: "pactl:hydra_test_output",
          label: "Hydra Test Output",
          isDefault: false,
        },
      ]
    );
  });
});
