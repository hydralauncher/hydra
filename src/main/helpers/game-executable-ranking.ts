export interface KnownGameExecutable {
  exe: string;
  name: string;
}

const toSegments = (value: string) =>
  value.toLowerCase().split(/[\\/]/).filter(Boolean);

const basenameOf = (relativePath: string) => toSegments(relativePath).at(-1);

const directoryOf = (relativePath: string) => {
  const segments = toSegments(relativePath);
  return segments.slice(0, -1).join("/");
};

const endsWithSegments = (relativePath: string, suffix: string) => {
  const pathSegments = toSegments(relativePath);
  const suffixSegments = toSegments(suffix);

  if (suffixSegments.length > pathSegments.length) return false;

  const offset = pathSegments.length - suffixSegments.length;
  return suffixSegments.every(
    (segment, index) => segment === pathSegments[offset + index]
  );
};

const isNestedCopyOf = (relativePath: string, other: string) => {
  if (relativePath === other) return false;

  const pathSegments = toSegments(relativePath);
  const otherSegments = toSegments(other);

  if (otherSegments.length >= pathSegments.length) return false;

  const offset = pathSegments.length - otherSegments.length;
  return otherSegments.every(
    (segment, index) => segment === pathSegments[offset + index]
  );
};

const countBasenames = (relativeFilePaths: string[]) => {
  const counts = new Map<string, number>();

  for (const filePath of relativeFilePaths) {
    const basename = basenameOf(filePath);
    if (basename) counts.set(basename, (counts.get(basename) ?? 0) + 1);
  }

  return counts;
};

const countUnsharedSiblings = (
  relativePath: string,
  relativeFilePaths: string[],
  basenameCounts: Map<string, number>
) => {
  const directory = directoryOf(relativePath);

  return relativeFilePaths.filter((filePath) => {
    if (directoryOf(filePath) !== directory) return false;

    const basename = basenameOf(filePath);
    return !!basename && basenameCounts.get(basename) === 1;
  }).length;
};

export const rankExecutableCandidates = (
  relativeFilePaths: string[],
  executables: KnownGameExecutable[]
): string | null => {
  const executableIndexes = new Map<string, number>();

  executables.forEach((executable, index) => {
    const exe = executable.exe.toLowerCase();
    if (!executableIndexes.has(exe)) executableIndexes.set(exe, index);
  });

  const candidates = relativeFilePaths.filter((filePath) => {
    const basename = basenameOf(filePath);
    return !!basename && executableIndexes.has(basename);
  });

  if (candidates.length <= 1) return candidates[0] ?? null;

  const suffixes = executables
    .map((executable) => executable.name)
    .filter((name) => toSegments(name).length > 1);

  const preferred = candidates.filter((candidate) =>
    suffixes.some((suffix) => endsWithSegments(candidate, suffix))
  );

  const pool = preferred.length > 0 ? preferred : candidates;
  if (pool.length === 1) return pool[0];

  const originals = pool.filter(
    (candidate) => !pool.some((other) => isNestedCopyOf(candidate, other))
  );

  const remaining = originals.length > 0 ? originals : pool;
  if (remaining.length === 1) return remaining[0];

  const basenameCounts = countBasenames(relativeFilePaths);

  const scoreOf = (relativePath: string) => [
    -countUnsharedSiblings(relativePath, relativeFilePaths, basenameCounts),
    toSegments(relativePath).length,
    executableIndexes.get(basenameOf(relativePath)!) ?? Number.MAX_SAFE_INTEGER,
  ];

  const ranked = remaining
    .map((relativePath) => ({ relativePath, score: scoreOf(relativePath) }))
    .sort(
      (a, b) =>
        a.score[0] - b.score[0] ||
        a.score[1] - b.score[1] ||
        a.score[2] - b.score[2] ||
        a.relativePath.localeCompare(b.relativePath)
    );

  const isTied = ranked[0].score.every(
    (value, index) => value === ranked[1].score[index]
  );

  return isTied ? null : ranked[0].relativePath;
};
