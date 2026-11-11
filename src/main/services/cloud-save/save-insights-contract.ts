import type {
  SaveSlotKind,
  SaveStat,
  SaveStatKind,
  SaveStatValue,
  SaveSummary,
  SaveSummarySlot,
} from "@types";

const SLOT_KINDS: readonly SaveSlotKind[] = [
  "manual",
  "auto",
  "quick",
  "pointOfNoReturn",
  "endGame",
  "profile",
  "unknown",
];

const STAT_KINDS: readonly SaveStatKind[] = [
  "playtime",
  "level",
  "chapter",
  "inGameDay",
  "quest",
  "questsCompleted",
  "objective",
  "location",
  "completion",
  "money",
  "difficulty",
  "newGamePlus",
  "characterName",
  "characterClass",
  "reputation",
  "collectibles",
  "deaths",
  "content",
  "gameVersion",
  "achievements",
  "hearts",
];

const MAX_SLOTS = 512;
const MAX_STATS = 64;
const MAX_TEXT_LENGTH = 512;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isText = (value: unknown): value is string =>
  typeof value === "string" && value.length <= MAX_TEXT_LENGTH;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const parseValue = (value: unknown): SaveStatValue | null => {
  if (!isRecord(value)) return null;
  const inner = value.value;
  switch (value.type) {
    case "integer":
    case "seconds":
    case "percent":
      return isFiniteNumber(inner) ? { type: value.type, value: inner } : null;
    case "text":
      return isText(inner) ? { type: "text", value: inner } : null;
    case "progress":
      return isRecord(inner) &&
        isFiniteNumber(inner.current) &&
        isFiniteNumber(inner.total)
        ? {
            type: "progress",
            value: { current: inner.current, total: inner.total },
          }
        : null;
    case "list":
      return Array.isArray(inner) && inner.every(isText)
        ? { type: "list", value: inner.slice(0, MAX_STATS) }
        : null;
    case "label":
      return isRecord(inner) && isText(inner.key) && isText(inner.text)
        ? { type: "label", value: { key: inner.key, text: inner.text } }
        : null;
    default:
      return null;
  }
};

const parseStats = (value: unknown): SaveStat[] =>
  (Array.isArray(value) ? value.slice(0, MAX_STATS) : []).flatMap((stat) => {
    if (!isRecord(stat)) return [];
    const kind = stat.kind as SaveStatKind;
    const parsed = parseValue(stat.value);
    const name =
      isRecord(stat.name) && isText(stat.name.key) && isText(stat.name.text)
        ? { key: stat.name.key, text: stat.name.text }
        : undefined;
    return STAT_KINDS.includes(kind) && parsed
      ? [{ kind, value: parsed, ...(name ? { name } : {}) }]
      : [];
  });

const parseSlot = (value: unknown): SaveSummarySlot | null => {
  if (!isRecord(value) || !isText(value.id) || !value.id) return null;
  const kind = SLOT_KINDS.includes(value.kind as SaveSlotKind)
    ? (value.kind as SaveSlotKind)
    : "unknown";
  return {
    id: value.id,
    kind,
    ...(isText(value.title) ? { title: value.title } : {}),
    ...(isFiniteNumber(value.savedAtMs) ? { savedAtMs: value.savedAtMs } : {}),
    ...(isText(value.playthrough) ? { playthrough: value.playthrough } : {}),
    stats: parseStats(value.stats),
    files: Array.isArray(value.files) ? value.files.filter(isText) : [],
  };
};

/** Lenient on purpose: a bad summary only hides the extra details, never the snapshot. */
export const parseSaveSummary = (value: unknown): SaveSummary | null => {
  if (typeof value === "string") {
    try {
      return parseSaveSummary(JSON.parse(value));
    } catch {
      return null;
    }
  }
  if (!isRecord(value) || value.schemaVersion !== 1) return null;
  const slots = (Array.isArray(value.slots) ? value.slots : [])
    .slice(0, MAX_SLOTS)
    .map(parseSlot)
    .filter((slot): slot is SaveSummarySlot => slot !== null);
  const profile = parseStats(value.profile);
  if (slots.length === 0 && profile.length === 0) return null;
  return {
    schemaVersion: 1,
    parsers: Array.isArray(value.parsers) ? value.parsers.filter(isText) : [],
    profile,
    slots,
  };
};
