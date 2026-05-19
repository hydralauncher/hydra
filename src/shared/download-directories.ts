import type { DownloadDirectoryPreference, UserPreferences } from "@types";

export const MAX_DOWNLOAD_DIRECTORIES = 5;
export const MAX_OPTIONAL_DOWNLOAD_DIRECTORIES = MAX_DOWNLOAD_DIRECTORIES - 1;

export interface ResolvedDownloadDirectories {
  persistedDefaultPath: string | null;
  defaultPath: string;
  directories: DownloadDirectoryPreference[];
  savedPaths: string[];
  optionalPaths: string[];
  allPaths: string[];
}

type DownloadDirectoryPreferences = Pick<
  UserPreferences,
  "downloadsPath" | "downloadDirectories" | "optionalDownloadsPaths"
>;

interface DownloadDirectoryRecordWithTimestamp
  extends DownloadDirectoryPreference {
  timestamp: number;
  originalIndex: number;
}

const SYNTHETIC_CREATED_AT_STEP_MS = 1000;

const sanitizePath = (value: string | null | undefined) => {
  if (!value) return null;

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
};

const dedupePaths = (paths: Array<string | null | undefined>) => {
  const seen = new Set<string>();

  return paths.reduce<string[]>((result, path) => {
    const sanitizedPath = sanitizePath(path);

    if (!sanitizedPath || seen.has(sanitizedPath)) {
      return result;
    }

    seen.add(sanitizedPath);
    result.push(sanitizedPath);
    return result;
  }, []);
};

const sanitizeCreatedAt = (value: string | null | undefined) => {
  const timestamp = new Date(value ?? "").getTime();

  if (!Number.isFinite(timestamp)) {
    return new Date(0).toISOString();
  }

  return new Date(timestamp).toISOString();
};

const normalizeDownloadDirectoryRecords = (
  records: Array<DownloadDirectoryPreference | null | undefined>,
  fixedPath: string
) => {
  const normalizedRecords = records.reduce<
    DownloadDirectoryRecordWithTimestamp[]
  >((result, record, originalIndex) => {
    const sanitizedPath = sanitizePath(record?.path);

    if (!sanitizedPath || sanitizedPath === fixedPath) {
      return result;
    }

    const createdAt = sanitizeCreatedAt(record?.createdAt);

    result.push({
      path: sanitizedPath,
      createdAt,
      timestamp: new Date(createdAt).getTime(),
      originalIndex,
    });

    return result;
  }, []);

  normalizedRecords.sort((firstRecord, secondRecord) => {
    if (firstRecord.timestamp === secondRecord.timestamp) {
      return firstRecord.originalIndex - secondRecord.originalIndex;
    }

    return secondRecord.timestamp - firstRecord.timestamp;
  });

  const seenPaths = new Set<string>();

  return normalizedRecords
    .filter((record) => {
      if (seenPaths.has(record.path)) {
        return false;
      }

      seenPaths.add(record.path);
      return true;
    })
    .slice(0, MAX_OPTIONAL_DOWNLOAD_DIRECTORIES)
    .map<DownloadDirectoryPreference>(({ path, createdAt }) => ({
      path,
      createdAt,
    }));
};

const buildLegacyDownloadDirectoryRecords = (
  preferences: DownloadDirectoryPreferences | null | undefined,
  fallbackDefaultPath: string
) => {
  const persistedDefaultPath = sanitizePath(preferences?.downloadsPath);
  const normalizedPersistedDefaultPath =
    persistedDefaultPath && persistedDefaultPath !== fallbackDefaultPath
      ? persistedDefaultPath
      : null;
  const orderedPaths = dedupePaths(preferences?.optionalDownloadsPaths ?? []);

  if (
    normalizedPersistedDefaultPath &&
    !orderedPaths.includes(normalizedPersistedDefaultPath)
  ) {
    orderedPaths.unshift(normalizedPersistedDefaultPath);
  }

  const syntheticBaseTimestamp = Date.now();

  return orderedPaths
    .filter((path) => path !== fallbackDefaultPath)
    .slice(0, MAX_OPTIONAL_DOWNLOAD_DIRECTORIES)
    .map<DownloadDirectoryPreference>((path, index) => ({
      path,
      createdAt: new Date(
        syntheticBaseTimestamp - index * SYNTHETIC_CREATED_AT_STEP_MS
      ).toISOString(),
    }));
};

export function resolveDownloadDirectories(
  preferences: DownloadDirectoryPreferences | null | undefined,
  fallbackDefaultPath: string
): ResolvedDownloadDirectories {
  const sanitizedFallbackDefaultPath = sanitizePath(fallbackDefaultPath);

  if (!sanitizedFallbackDefaultPath) {
    throw new Error("A fallback downloads path is required.");
  }

  const rawPersistedDefaultPath = sanitizePath(preferences?.downloadsPath);
  const directories = Array.isArray(preferences?.downloadDirectories)
    ? normalizeDownloadDirectoryRecords(
        preferences?.downloadDirectories,
        sanitizedFallbackDefaultPath
      )
    : normalizeDownloadDirectoryRecords(
        buildLegacyDownloadDirectoryRecords(
          preferences,
          sanitizedFallbackDefaultPath
        ),
        sanitizedFallbackDefaultPath
      );

  const savedPaths = directories.map((directory) => directory.path);
  const persistedDefaultPath =
    rawPersistedDefaultPath &&
    rawPersistedDefaultPath !== sanitizedFallbackDefaultPath &&
    savedPaths.includes(rawPersistedDefaultPath)
      ? rawPersistedDefaultPath
      : null;
  const defaultPath = persistedDefaultPath ?? sanitizedFallbackDefaultPath;
  const allPaths = [...savedPaths, sanitizedFallbackDefaultPath];
  const optionalPaths = [...savedPaths];

  return {
    persistedDefaultPath,
    defaultPath,
    directories,
    savedPaths,
    optionalPaths,
    allPaths,
  };
}

export function getDownloadDirectoryPreferences(
  preferences: DownloadDirectoryPreferences | null | undefined,
  fallbackDefaultPath: string
): DownloadDirectoryPreferences {
  const resolvedDirectories = resolveDownloadDirectories(
    preferences,
    fallbackDefaultPath
  );

  return {
    downloadsPath: resolvedDirectories.persistedDefaultPath,
    downloadDirectories: resolvedDirectories.directories,
    optionalDownloadsPaths: resolvedDirectories.directories.map(
      (directory) => directory.path
    ),
  };
}

export function setDefaultDownloadDirectory(
  preferences: DownloadDirectoryPreferences | null | undefined,
  nextDefaultPath: string,
  fallbackDefaultPath: string
): DownloadDirectoryPreferences {
  const resolvedDirectories = resolveDownloadDirectories(
    preferences,
    fallbackDefaultPath
  );
  const sanitizedNextDefaultPath = sanitizePath(nextDefaultPath);

  if (!sanitizedNextDefaultPath) {
    return getDownloadDirectoryPreferences(preferences, fallbackDefaultPath);
  }

  if (sanitizedNextDefaultPath === resolvedDirectories.defaultPath) {
    return getDownloadDirectoryPreferences(preferences, fallbackDefaultPath);
  }

  if (sanitizedNextDefaultPath === fallbackDefaultPath) {
    return getDownloadDirectoryPreferences(
      {
        downloadsPath: null,
        downloadDirectories: resolvedDirectories.directories,
      },
      fallbackDefaultPath
    );
  }

  if (!resolvedDirectories.savedPaths.includes(sanitizedNextDefaultPath)) {
    return getDownloadDirectoryPreferences(preferences, fallbackDefaultPath);
  }

  return getDownloadDirectoryPreferences(
    {
      downloadsPath: sanitizedNextDefaultPath,
      downloadDirectories: resolvedDirectories.directories,
    },
    fallbackDefaultPath
  );
}

export function addOptionalDownloadDirectory(
  preferences: DownloadDirectoryPreferences | null | undefined,
  nextPath: string,
  fallbackDefaultPath: string
): DownloadDirectoryPreferences {
  const resolvedDirectories = resolveDownloadDirectories(
    preferences,
    fallbackDefaultPath
  );
  const sanitizedNextPath = sanitizePath(nextPath);

  if (
    !sanitizedNextPath ||
    sanitizedNextPath === fallbackDefaultPath ||
    resolvedDirectories.allPaths.includes(sanitizedNextPath) ||
    resolvedDirectories.savedPaths.length >= MAX_OPTIONAL_DOWNLOAD_DIRECTORIES
  ) {
    return getDownloadDirectoryPreferences(preferences, fallbackDefaultPath);
  }

  return getDownloadDirectoryPreferences(
    {
      downloadsPath: resolvedDirectories.persistedDefaultPath,
      downloadDirectories: [
        {
          path: sanitizedNextPath,
          createdAt: new Date().toISOString(),
        },
        ...resolvedDirectories.directories,
      ],
    },
    fallbackDefaultPath
  );
}

export function removeDownloadDirectory(
  preferences: DownloadDirectoryPreferences | null | undefined,
  pathToRemove: string,
  fallbackDefaultPath: string
): DownloadDirectoryPreferences {
  const resolvedDirectories = resolveDownloadDirectories(
    preferences,
    fallbackDefaultPath
  );
  const sanitizedPathToRemove = sanitizePath(pathToRemove);

  if (!sanitizedPathToRemove) {
    return getDownloadDirectoryPreferences(preferences, fallbackDefaultPath);
  }

  if (
    sanitizedPathToRemove === fallbackDefaultPath ||
    !resolvedDirectories.savedPaths.includes(sanitizedPathToRemove)
  ) {
    return getDownloadDirectoryPreferences(preferences, fallbackDefaultPath);
  }

  if (sanitizedPathToRemove !== resolvedDirectories.defaultPath) {
    return getDownloadDirectoryPreferences(
      {
        downloadsPath: resolvedDirectories.persistedDefaultPath,
        downloadDirectories: resolvedDirectories.directories.filter(
          (directory) => directory.path !== sanitizedPathToRemove
        ),
      },
      fallbackDefaultPath
    );
  }

  const remainingDirectories = resolvedDirectories.directories.filter(
    (directory) => directory.path !== sanitizedPathToRemove
  );

  return getDownloadDirectoryPreferences(
    {
      downloadsPath: null,
      downloadDirectories: remainingDirectories,
    },
    fallbackDefaultPath
  );
}

export function getDownloadDirectoryTitle(path: string) {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) || path;
}
