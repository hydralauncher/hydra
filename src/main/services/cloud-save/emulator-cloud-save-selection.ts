import type { EmulatorCloudSaveSelection, EmulatorLocalSaveCopy } from "@types";

interface SelectableEmulatorSaveCopy {
  candidate: EmulatorLocalSaveCopy;
}

export const selectEmulatorSaveCopies = <T extends SelectableEmulatorSaveCopy>(
  copies: T[],
  preferences: Record<string, string>,
  readableCardPaths: ReadonlySet<string>
) => {
  const byIdentity = new Map<string, T[]>();
  for (const copy of copies) {
    const group = byIdentity.get(copy.candidate.saveIdentity) ?? [];
    group.push(copy);
    byIdentity.set(copy.candidate.saveIdentity, group);
  }

  const selected: T[] = [];
  const selections: EmulatorCloudSaveSelection[] = [];
  const identities = new Set([
    ...byIdentity.keys(),
    ...Object.keys(preferences),
  ]);

  for (const saveIdentity of [...identities].sort()) {
    const group = byIdentity.get(saveIdentity) ?? [];
    group.sort((left, right) =>
      left.candidate.cardFilePath.localeCompare(right.candidate.cardFilePath)
    );
    const preferredPath = preferences[saveIdentity];
    if (preferredPath) {
      const preferred = group.find(
        (copy) => copy.candidate.cardFilePath === preferredPath
      );
      if (preferred) {
        selected.push(preferred);
      } else if (!readableCardPaths.has(preferredPath)) {
        selections.push({
          reason: "preferred-card-missing",
          saveIdentities: [saveIdentity],
          candidates: group.map(({ candidate }) => candidate),
        });
      }
      continue;
    }

    if (group.length === 0) continue;
    const hashes = new Set(
      group.map(({ candidate }) =>
        JSON.stringify([candidate.hash, candidate.sizeBytes])
      )
    );
    if (group.length === 1 || hashes.size === 1) {
      selected.push(group[0]);
    } else {
      selections.push({
        reason: "divergent-copies",
        saveIdentities: [saveIdentity],
        candidates: group.map(({ candidate }) => candidate),
      });
    }
  }

  return { selected, selections };
};
