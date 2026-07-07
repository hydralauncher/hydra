import YAML, {
  isMap as isYamlMap,
  isSeq as isYamlSequence,
  Scalar as YamlScalar,
} from "yaml";

import type {
  HydraManifestFileRule,
  HydraManifestGameEntry,
  HydraManifestIndex,
} from "./types";

type RawManifestWhenCondition = {
  os?: string;
  store?: string;
};

type RawManifestFileEntry = {
  tags?: string[];
  when?: RawManifestWhenCondition[];
};

const readYamlString = (value: unknown): string | null => {
  if (typeof value === "string") return value;
  if (value instanceof YamlScalar && typeof value.value === "string") {
    return value.value;
  }

  return null;
};

const readWhenCondition = (item: unknown): RawManifestWhenCondition | null => {
  if (!isYamlMap(item)) return null;

  const os = readYamlString(item.get("os", true));
  const store = readYamlString(item.get("store", true));

  if (!os && !store) {
    return null;
  }

  return {
    ...(os ? { os } : {}),
    ...(store ? { store } : {}),
  };
};

const readWhenConditions = (value: unknown): RawManifestWhenCondition[] => {
  if (!isYamlSequence(value)) return [];

  return value.items
    .map((item) => readWhenCondition(item))
    .filter(
      (condition): condition is RawManifestWhenCondition => condition !== null
    );
};

const readRuleTags = (value: unknown): string[] => {
  if (!isYamlSequence(value)) return [];

  return value.items
    .map((item) => readYamlString(item))
    .filter((tag): tag is string => Boolean(tag));
};

const mapManifestFileRule = (
  rawPath: string,
  metadata: unknown
): HydraManifestFileRule => {
  if (!isYamlMap(metadata)) {
    return {
      rawPath,
      tags: [],
      when: [],
    };
  }

  const normalizedManifestFileEntry: RawManifestFileEntry = {
    tags: readRuleTags(metadata.get("tags", true)),
    when: readWhenConditions(metadata.get("when", true)),
  };

  return {
    rawPath,
    tags: normalizedManifestFileEntry.tags ?? [],
    when: normalizedManifestFileEntry.when ?? [],
  };
};

const mapManifestGameEntry = (
  manifestKey: string,
  entry: unknown
): HydraManifestGameEntry | null => {
  if (!isYamlMap(entry)) {
    return null;
  }

  const manifestFiles = entry.get("files", true);
  if (!isYamlMap(manifestFiles)) {
    return null;
  }

  const manifestFileRules = manifestFiles.items
    .map((pair) => {
      const rawPath = readYamlString(pair.key);
      if (!rawPath) return null;

      return mapManifestFileRule(rawPath, pair.value);
    })
    .filter((file): file is HydraManifestFileRule => file !== null);

  if (manifestFileRules.length === 0) {
    return null;
  }

  return {
    manifestKey,
    files: manifestFileRules,
  };
};

export const buildHydraManifestIndex = (
  rawYaml: string,
  sourceUrl: string,
  fetchedAt = Date.now()
): HydraManifestIndex => {
  const document = YAML.parseDocument(rawYaml);

  if (document.errors.length > 0) {
    throw document.errors[0];
  }

  const manifestRoot = document.contents;
  if (!isYamlMap(manifestRoot)) {
    throw new Error("Cloud save manifest root must be a YAML map");
  }

  const games: HydraManifestIndex["games"] = {};

  for (const pair of manifestRoot.items) {
    const manifestKey = readYamlString(pair.key);
    if (!manifestKey) continue;

    const manifestGameEntry = mapManifestGameEntry(manifestKey, pair.value);
    if (!manifestGameEntry) continue;

    games[manifestKey] = manifestGameEntry;
  }

  return {
    version: 1,
    fetchedAt,
    sourceUrl,
    games,
  };
};
