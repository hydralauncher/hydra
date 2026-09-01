import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import { EMULATOR_SYSTEMS } from "@shared";
import type { EmulatorConfigMap } from "@types";

const detectEmulatorsEvent = async (): Promise<EmulatorConfigMap> => {
  const results = await Promise.all(
    EMULATOR_SYSTEMS.map(async (system) => {
      const binary = emulators.KNOWN_BINARIES[system];
      const result = emulators.detectEmulator(binary);
      const next = await emulators.updateEmulatorConfig(system, (current) => ({
        ...current,
        executablePath: result?.executablePath ?? current.executablePath,
        detectedVersion: result?.detectedVersion ?? current.detectedVersion,
        detectedAt: result ? Date.now() : current.detectedAt,
      }));
      return [system, next] as const;
    })
  );
  return Object.fromEntries(results) as EmulatorConfigMap;
};

registerEvent("detectEmulators", detectEmulatorsEvent);
