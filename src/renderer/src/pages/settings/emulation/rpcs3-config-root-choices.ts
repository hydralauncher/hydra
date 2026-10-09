import type { Rpcs3ConfigRootStatus } from "@types";

export const getRpcs3ConfigRootChoices = (
  status: Rpcs3ConfigRootStatus | null
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
