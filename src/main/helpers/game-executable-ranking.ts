export interface KnownGameExecutable {
  exe: string;
  name: string;
}

const REDIST_DIRECTORIES = new Set([
  "_commonredist",
  "commonredist",
  "steamworks shared",
  "redist",
  "redists",
  "_redist",
  "directx",
  "dotnet",
  "dotnetfx",
  "vcredist",
  "openal",
  "physx",
  "prerequisites",
  "prereq",
]);

const REDIST_FILE_PATTERN =
  /^(vcredist|vc_redist|dotnetfx|dxsetup|dxwebsetup|directx|oalinst|xnafx|physx|ue[345]prereqsetup|ue3redist)/;

const SHARED_INSTALLER_PATTERN =
  /^(uplayinstaller|pbsvc|pbsetup|setup_battleye|beservice|social-club-setup|easyanticheat|dauservicesetup)/;

const SHARED_RUNTIME_FILES = new Set([
  "unitycrashhandler32.exe",
  "unitycrashhandler64.exe",
  "crashreportclient.exe",
  "crashpad_handler.exe",
  "unrealcefsubprocess.exe",
  "epicwebhelper.exe",
  "start_protected_game.exe",
  "javaw.exe",
  "java.exe",
  "dotnet.exe",
  "setup.exe",
]);

const toSegments = (value: string) =>
  value.toLowerCase().split(/[\\/]/).filter(Boolean);

const basenameOf = (relativePath: string) => toSegments(relativePath).at(-1);

export const isRedistributableDirectory = (directoryName: string) =>
  REDIST_DIRECTORIES.has(directoryName.toLowerCase());

export const isRedistributablePath = (relativePath: string) => {
  const segments = toSegments(relativePath);
  const basename = segments.pop() ?? "";

  return (
    REDIST_FILE_PATTERN.test(basename) ||
    SHARED_INSTALLER_PATTERN.test(basename) ||
    SHARED_RUNTIME_FILES.has(basename) ||
    segments.some((segment) => REDIST_DIRECTORIES.has(segment))
  );
};

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

export type ExecutableSearchScope = "installation" | "library";

const installationOf = (relativePath: string) => {
  const segments = toSegments(relativePath);
  return segments.length > 1 ? segments[0] : "";
};

const stripInstallation = (relativePath: string, installation: string) =>
  installation
    ? relativePath.slice(relativePath.search(/[\\/]/) + 1)
    : relativePath;

export const rankExecutableCandidates = (
  relativeFilePaths: string[],
  executables: KnownGameExecutable[],
  scope: ExecutableSearchScope = "installation"
): string | null => {
  if (scope === "library") {
    return rankAcrossInstallations(relativeFilePaths, executables);
  }

  const executableIndexes = new Map<string, number>();

  executables.forEach((executable, index) => {
    const exe = executable.exe.toLowerCase();
    if (!executableIndexes.has(exe)) executableIndexes.set(exe, index);
  });

  const candidates = relativeFilePaths.filter((filePath) => {
    const basename = basenameOf(filePath);
    return (
      !!basename &&
      executableIndexes.has(basename) &&
      !isRedistributablePath(filePath)
    );
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

const rankAcrossInstallations = (
  relativeFilePaths: string[],
  executables: KnownGameExecutable[]
): string | null => {
  const exeNames = new Set(
    executables.map((executable) => executable.exe.toLowerCase())
  );

  const candidates = relativeFilePaths.filter((filePath) => {
    const basename = basenameOf(filePath);
    return (
      !!basename && exeNames.has(basename) && !isRedistributablePath(filePath)
    );
  });

  if (candidates.length === 0) return null;

  const suffixes = executables
    .map((executable) => executable.name)
    .filter((name) => toSegments(name).length > 1);

  const named = candidates.filter((candidate) =>
    suffixes.some((suffix) => endsWithSegments(candidate, suffix))
  );

  const namedInstallations = new Set(named.map(installationOf));

  const installations =
    namedInstallations.size === 1
      ? namedInstallations
      : new Set(candidates.map(installationOf));

  if (installations.size !== 1) return null;

  const installation = [...installations][0];

  const withinInstallation = relativeFilePaths
    .filter((filePath) => installationOf(filePath) === installation)
    .map((filePath) => ({
      original: filePath,
      scoped: stripInstallation(filePath, installation),
    }));

  const match = rankExecutableCandidates(
    withinInstallation.map((entry) => entry.scoped),
    executables
  );

  if (!match) return null;

  return (
    withinInstallation.find((entry) => entry.scoped === match)?.original ?? null
  );
};
