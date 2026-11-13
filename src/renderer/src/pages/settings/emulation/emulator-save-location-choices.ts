import type { EmulatorSaveLocationStatus } from "@types";

export const getEmulatorSaveLocationChoices = (
  status: EmulatorSaveLocationStatus | null
) => {
  const selectedRoot = status?.selectedRoot ?? status?.resolvedRoot ?? "";
  const candidates = status?.candidates ?? [];

  return {
    selectedRoot,
    roots:
      selectedRoot && !candidates.includes(selectedRoot)
        ? [...candidates, selectedRoot]
        : candidates,
  };
};
