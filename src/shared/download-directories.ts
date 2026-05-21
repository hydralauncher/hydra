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

export type PreparedDefaultDownloadPathSync =
  | { type: "noop" }
  | {
      type: "set-existing";
      nextPreferences: DownloadDirectoryPreferences;
      nextDefaultPath: string;
    }
  | {
      type: "add-and-set";
      nextPreferences: DownloadDirectoryPreferences;
      nextDefaultPath: string;
    }
  | {
      type: "replace-required";
      nextPath: string;
      nextDefaultPath: string;
      replaceableDirectories: DownloadDirectoryPreference[];
      recommendedReplacementPath: string;
    };

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

const sanitizeDirectorySource = (
  value: DownloadDirectoryPreference["source"] | null | undefined
): DownloadDirectoryPreference["source"] => {
  return value === "auto" ? "auto" : "manual";
};

const createDownloadDirectoryRecord = (
  path: string,
  createdAt: string,
  source: DownloadDirectoryPreference["source"]
): DownloadDirectoryPreference => ({
  path,
  createdAt,
  source,
});

const normalizeDownloadDirectoryRecords = (
  records: Array<DownloadDirectoryPreference | null | undefined>,
  fixedPath: string,
  preservedPath?: string | null
) => {
  const normalizedRecords = records.reduce<
    DownloadDirectoryRecordWithTimestamp[]
  >((result, record, originalIndex) => {
    const sanitizedPath = sanitizePath(record?.path);

    if (!sanitizedPath || sanitizedPath === fixedPath) {
      return result;
    }

    const createdAt = sanitizeCreatedAt(record?.createdAt);
    const source = sanitizeDirectorySource(record?.source);

    result.push({
      path: sanitizedPath,
      createdAt,
      source,
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

  const uniqueRecords = normalizedRecords.filter((record) => {
    if (seenPaths.has(record.path)) {
      return false;
    }

    seenPaths.add(record.path);
    return true;
  });

  const normalizedPreservedPath =
    sanitizePath(preservedPath) !== fixedPath
      ? sanitizePath(preservedPath)
      : null;

  const preservedRecordIndex = normalizedPreservedPath
    ? uniqueRecords.findIndex(
        (record) => record.path === normalizedPreservedPath
      )
    : -1;

  const limitedRecords =
    preservedRecordIndex >= MAX_OPTIONAL_DOWNLOAD_DIRECTORIES
      ? [
          ...uniqueRecords.slice(0, MAX_OPTIONAL_DOWNLOAD_DIRECTORIES - 1),
          uniqueRecords[preservedRecordIndex],
        ]
      : uniqueRecords.slice(0, MAX_OPTIONAL_DOWNLOAD_DIRECTORIES);

  return limitedRecords.map<DownloadDirectoryPreference>(
    ({ path, createdAt, source }) =>
      createDownloadDirectoryRecord(path, createdAt, source)
  );
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
    .map<DownloadDirectoryPreference>((path, index) =>
      createDownloadDirectoryRecord(
        path,
        new Date(
          syntheticBaseTimestamp - index * SYNTHETIC_CREATED_AT_STEP_MS
        ).toISOString(),
        "manual"
      )
    );
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
  const preservedDefaultPath =
    rawPersistedDefaultPath &&
    rawPersistedDefaultPath !== sanitizedFallbackDefaultPath
      ? rawPersistedDefaultPath
      : null;
  const directories = Array.isArray(preferences?.downloadDirectories)
    ? normalizeDownloadDirectoryRecords(
        preferences?.downloadDirectories,
        sanitizedFallbackDefaultPath,
        preservedDefaultPath
      )
    : normalizeDownloadDirectoryRecords(
        buildLegacyDownloadDirectoryRecords(
          preferences,
          sanitizedFallbackDefaultPath
        ),
        sanitizedFallbackDefaultPath,
        preservedDefaultPath
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

export function prepareDefaultDownloadPathSync(
  preferences: DownloadDirectoryPreferences | null | undefined,
  nextPath: string,
  fallbackDefaultPath: string
): PreparedDefaultDownloadPathSync {
  const resolvedDirectories = resolveDownloadDirectories(
    preferences,
    fallbackDefaultPath
  );
  const sanitizedNextPath = sanitizePath(nextPath);
  const sanitizedFallbackDefaultPath = sanitizePath(fallbackDefaultPath);
  const rawPersistedDefaultPath = sanitizePath(preferences?.downloadsPath);
  const currentDefaultPath =
    rawPersistedDefaultPath ?? sanitizedFallbackDefaultPath ?? "";

  if (!sanitizedNextPath || sanitizedNextPath === currentDefaultPath) {
    return { type: "noop" };
  }

  if (sanitizedNextPath === sanitizedFallbackDefaultPath) {
    return {
      type: "set-existing",
      nextPreferences: getDownloadDirectoryPreferences(
        {
          downloadsPath: null,
          downloadDirectories: resolvedDirectories.directories,
        },
        fallbackDefaultPath
      ),
      nextDefaultPath: sanitizedFallbackDefaultPath ?? "",
    };
  }

  if (resolvedDirectories.savedPaths.includes(sanitizedNextPath)) {
    return {
      type: "set-existing",
      nextPreferences: getDownloadDirectoryPreferences(
        {
          downloadsPath: sanitizedNextPath,
          downloadDirectories: resolvedDirectories.directories,
        },
        fallbackDefaultPath
      ),
      nextDefaultPath: sanitizedNextPath,
    };
  }

  const mostRecentSavedDirectory = resolvedDirectories.directories[0];

  if (mostRecentSavedDirectory?.source === "auto") {
    return {
      type: "add-and-set",
      nextPreferences: getDownloadDirectoryPreferences(
        {
          downloadsPath: sanitizedNextPath,
          downloadDirectories: [
            createDownloadDirectoryRecord(
              sanitizedNextPath,
              new Date().toISOString(),
              "auto"
            ),
            ...resolvedDirectories.directories.filter(
              (directory) =>
                directory.path !== mostRecentSavedDirectory.path &&
                directory.path !== sanitizedNextPath
            ),
          ],
        },
        fallbackDefaultPath
      ),
      nextDefaultPath: sanitizedNextPath,
    };
  }

  if (
    resolvedDirectories.savedPaths.length < MAX_OPTIONAL_DOWNLOAD_DIRECTORIES
  ) {
    return {
      type: "add-and-set",
      nextPreferences: getDownloadDirectoryPreferences(
        {
          downloadsPath: sanitizedNextPath,
          downloadDirectories: [
            createDownloadDirectoryRecord(
              sanitizedNextPath,
              new Date().toISOString(),
              "auto"
            ),
            ...resolvedDirectories.directories,
          ],
        },
        fallbackDefaultPath
      ),
      nextDefaultPath: sanitizedNextPath,
    };
  }

  const currentSavedDefaultPath =
    rawPersistedDefaultPath &&
    resolvedDirectories.savedPaths.includes(rawPersistedDefaultPath)
      ? rawPersistedDefaultPath
      : null;
  const recommendedReplacementPath =
    currentSavedDefaultPath ??
    resolvedDirectories.directories.at(-1)?.path ??
    resolvedDirectories.directories[0]?.path ??
    sanitizedNextPath;

  return {
    type: "replace-required",
    nextPath: sanitizedNextPath,
    nextDefaultPath: sanitizedNextPath,
    replaceableDirectories: resolvedDirectories.directories,
    recommendedReplacementPath,
  };
}

export function replaceSavedDownloadDirectoryAndSetDefault(
  preferences: DownloadDirectoryPreferences | null | undefined,
  nextPath: string,
  pathToReplace: string,
  fallbackDefaultPath: string
) {
  const resolvedDirectories = resolveDownloadDirectories(
    preferences,
    fallbackDefaultPath
  );
  const sanitizedNextPath = sanitizePath(nextPath);
  const sanitizedPathToReplace = sanitizePath(pathToReplace);

  if (
    !sanitizedNextPath ||
    !sanitizedPathToReplace ||
    !resolvedDirectories.savedPaths.includes(sanitizedPathToReplace)
  ) {
    return {
      nextPreferences: getDownloadDirectoryPreferences(
        preferences,
        fallbackDefaultPath
      ),
      nextDefaultPath: resolvedDirectories.defaultPath,
    };
  }

  return {
    nextPreferences: getDownloadDirectoryPreferences(
      {
        downloadsPath: sanitizedNextPath,
        downloadDirectories: [
          createDownloadDirectoryRecord(
            sanitizedNextPath,
            new Date().toISOString(),
            "auto"
          ),
          ...resolvedDirectories.directories.filter(
            (directory) =>
              directory.path !== sanitizedPathToReplace &&
              directory.path !== sanitizedNextPath
          ),
        ],
      },
      fallbackDefaultPath
    ),
    nextDefaultPath: sanitizedNextPath,
  };
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
        createDownloadDirectoryRecord(
          sanitizedNextPath,
          new Date().toISOString(),
          "manual"
        ),
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
