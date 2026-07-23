export type RestoreVersionIdentity = { id: string; version: number };

export const getRestoreVersionDecision = (
  expected: RestoreVersionIdentity,
  current: RestoreVersionIdentity | null,
  previousVersionChanges: number
) => {
  if (current?.id === expected.id && current.version === expected.version) {
    return "stable" as const;
  }
  if (current && previousVersionChanges === 0) {
    return "retry" as const;
  }
  return "abort" as const;
};
