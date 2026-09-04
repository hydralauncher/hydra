import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import { EMULATOR_SYSTEMS } from "@shared";
import type { EmulatorConfigMap } from "@types";

const detectEmulatorsEvent = async (): Promise<EmulatorConfigMap> => {
  const results = await Promise.all(
    EMULATOR_SYSTEMS.map(async (system) => {
      const binary = emulators.KNOWN_BINARIES[system];
      const result = await emulators.detectEmulatorWithDownloads(binary);
      const next = await emulators.updateEmulatorConfig(system, (current) => {
        if (result) {
          return {
            ...current,
            executablePath: result.executablePath,
            detectedVersion: result.detectedVersion ?? current.detectedVersion,
            detectedAt: Date.now(),
          };
        }

        const currentStillValid =
          current.executablePath !== null &&
          emulators.isValidEmulatorExecutableForBinary(
            current.executablePath,
            binary
          );

        if (currentStillValid) return current;

        return {
          ...current,
          executablePath: null,
          detectedVersion: null,
          detectedAt: null,
        };
      });
      return [system, next] as const;
    })
  );
  return Object.fromEntries(results) as EmulatorConfigMap;
};

registerEvent("detectEmulators", detectEmulatorsEvent);
