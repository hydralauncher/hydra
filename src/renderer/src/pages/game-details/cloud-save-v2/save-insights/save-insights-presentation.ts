import type {
  SaveSlotKind,
  SaveStat,
  SaveStatKind,
  SaveStatValue,
  SaveSummary,
  SaveSummarySlot,
} from "@types";

import type { SaveInsightsGame, SaveScene } from "./save-insights-games";

export interface SaveInsightsText {
  t: (key: string, options?: Record<string, unknown>) => string;
  label: (key: string, text: string) => string;
  number: (value: number) => string;
  date: (ms: number) => string;
}

export type SaveSide = "local" | "remote";

const FURTHER_KINDS: ReadonlySet<SaveStatKind> = new Set([
  "level",
  "playtime",
  "inGameDay",
  "completion",
  "questsCompleted",
  "newGamePlus",
  "reputation",
  "collectibles",
  "achievements",
  "hearts",
]);

const STAT_ROW_KINDS: readonly SaveStatKind[] = [
  "level",
  "playtime",
  "money",
  "reputation",
  "collectibles",
  "hearts",
  "achievements",
];

const CONFLICT_ROW_KINDS: readonly SaveStatKind[] = [
  "chapter",
  "level",
  "playtime",
  "completion",
  "inGameDay",
  "quest",
  "collectibles",
  "reputation",
  "questsCompleted",
  "hearts",
  "newGamePlus",
  "achievements",
  "location",
  "money",
];

const MAX_CARD_STATS = 3;
const MAX_CONFLICT_ROWS = 3;
const LOSS_WARNING_SECONDS = 60 * 60;

const SLOT_KIND_KEYS: Record<SaveSlotKind, string> = {
  manual: "save_insights_slot_manual",
  auto: "save_insights_slot_auto",
  quick: "save_insights_slot_quick",
  pointOfNoReturn: "save_insights_slot_point_of_no_return",
  endGame: "save_insights_slot_end_game",
  profile: "save_insights_slot_unknown",
  unknown: "save_insights_slot_unknown",
};

const STAT_NAME_KEYS: Record<SaveStatKind, string> = {
  playtime: "save_insights_stat_playtime",
  level: "save_insights_stat_level",
  chapter: "save_insights_stat_chapter",
  inGameDay: "save_insights_stat_in_game_day",
  quest: "save_insights_stat_quest",
  questsCompleted: "save_insights_stat_quests_completed",
  objective: "save_insights_stat_objective",
  location: "save_insights_stat_location",
  completion: "save_insights_stat_completion",
  money: "save_insights_stat_money",
  difficulty: "save_insights_stat_difficulty",
  newGamePlus: "save_insights_stat_new_game_plus",
  characterName: "save_insights_stat_character_name",
  characterClass: "save_insights_stat_character_class",
  reputation: "save_insights_stat_reputation",
  collectibles: "save_insights_stat_collectibles",
  deaths: "save_insights_stat_deaths",
  content: "save_insights_stat_content",
  gameVersion: "save_insights_stat_game_version",
  achievements: "save_insights_stat_achievements",
  hearts: "save_insights_stat_hearts",
};

const STAT_UNIT_KEYS: Partial<Record<SaveStatKind, string>> = {
  level: "save_insights_unit_level",
  reputation: "save_insights_unit_reputation",
  collectibles: "save_insights_unit_collectibles",
  hearts: "save_insights_unit_hearts",
  achievements: "save_insights_unit_achievements",
};

export const statValue = (
  stats: SaveStat[],
  kind: SaveStatKind
): SaveStatValue | undefined => stats.find((stat) => stat.kind === kind)?.value;

export const numericValue = (value: SaveStatValue | undefined) => {
  if (!value) return null;
  switch (value.type) {
    case "integer":
    case "seconds":
    case "percent":
      return value.value;
    case "progress":
      return value.value.current;
    default:
      return null;
  }
};

export const formatDuration = (seconds: number, text: SaveInsightsText) => {
  const totalMinutes = Math.max(0, Math.floor(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) {
    return text.t("save_insights_duration_minutes", { minutes });
  }
  return text.t("save_insights_duration_hours", {
    hours: text.number(hours),
    minutes: String(minutes).padStart(2, "0"),
  });
};

export const formatStatValue = (
  value: SaveStatValue,
  text: SaveInsightsText
): string => {
  switch (value.type) {
    case "integer":
      return text.number(value.value);
    case "seconds":
      return formatDuration(value.value, text);
    case "percent":
      return `${text.number(Math.round(value.value * 10) / 10)}%`;
    case "progress":
      return `${text.number(value.value.current)}/${text.number(value.value.total)}`;
    case "text":
      return value.value;
    case "label":
      return text.label(value.value.key, value.value.text);
    case "list":
      return value.value.join(" · ");
  }
};

const formatDelta = (
  kind: SaveStatKind,
  value: SaveStatValue,
  delta: number,
  text: SaveInsightsText
) => {
  if (value.type === "seconds") return formatDuration(delta, text);
  if (value.type === "percent") {
    return `${text.number(Math.round(delta * 10) / 10)}%`;
  }
  return kind === "level" ||
    value.type === "integer" ||
    value.type === "progress"
    ? text.number(delta)
    : null;
};

export const statName = (
  kind: SaveStatKind,
  stat: SaveStat | undefined,
  text: SaveInsightsText
) =>
  stat?.name
    ? text.label(stat.name.key, stat.name.text)
    : text.t(STAT_NAME_KEYS[kind]);

const statOf = (stats: SaveStat[], kind: SaveStatKind) =>
  stats.find((stat) => stat.kind === kind);

const statUnit = (
  kind: SaveStatKind,
  game: SaveInsightsGame,
  text: SaveInsightsText
) => {
  const unit = game.units?.[kind];
  if (unit) return text.t(`save_insights_unit_${unit}`);
  const key = STAT_UNIT_KEYS[kind];
  return key ? text.t(key) : null;
};

export const slotKindName = (kind: SaveSlotKind, text: SaveInsightsText) =>
  text.t(SLOT_KIND_KEYS[kind]);

export const playableSlots = (summary: SaveSummary | null) =>
  (summary?.slots ?? []).filter((slot) => slot.kind !== "profile");

export const newestSlot = (summary: SaveSummary | null) =>
  playableSlots(summary).reduce<SaveSummarySlot | null>(
    (newest, slot) =>
      !newest || (slot.savedAtMs ?? 0) > (newest.savedAtMs ?? 0)
        ? slot
        : newest,
    null
  );

const orderedTileSlots = (summary: SaveSummary | null) =>
  [...playableSlots(summary)].sort((left, right) =>
    left.id.localeCompare(right.id, undefined, { numeric: true })
  );

export interface SaveCardStat {
  kind: SaveStatKind;
  name: string;
  value: string;
  unit: string | null;
  steps: { current: number; total: number } | null;
}

export interface SaveCardTile {
  slotId: string;
  text: string;
  label: string;
}

export interface SaveCardModel {
  slot: SaveSummarySlot;
  heading: string;
  eyebrow: string | null;
  subtitle: string | null;
  completion: number | null;
  stats: SaveCardStat[];
  footer: string;
  tiles: SaveCardTile[];
  slotCount: number;
}

type HeadingKind =
  | "characterName"
  | "chapter"
  | "inGameDay"
  | "quest"
  | "level";

const headingOf = (
  slot: SaveSummarySlot,
  game: SaveInsightsGame,
  text: SaveInsightsText
): { kind: HeadingKind | null; heading: string; eyebrow: string | null } => {
  const value = (kind: SaveStatKind) => statValue(slot.stats, kind);
  const characterName = value("characterName");
  if (game.tiles === "level" && characterName) {
    return {
      kind: "characterName",
      heading: formatStatValue(characterName, text),
      eyebrow: null,
    };
  }
  const chapter = value("chapter");
  if (chapter) {
    return {
      kind: "chapter",
      heading: formatStatValue(chapter, text),
      eyebrow: null,
    };
  }
  const day = numericValue(value("inGameDay"));
  if (day !== null) {
    return {
      kind: "inGameDay",
      heading: text.t("save_insights_day", { day: text.number(day) }),
      eyebrow: null,
    };
  }
  const quest = value("quest");
  if (quest) {
    return {
      kind: "quest",
      heading: formatStatValue(quest, text),
      eyebrow: text.t("save_insights_last_mission"),
    };
  }
  const level = numericValue(value("level"));
  if (level !== null) {
    return {
      kind: "level",
      heading: text.t("save_insights_level", { level: text.number(level) }),
      eyebrow: null,
    };
  }
  return { kind: null, heading: slotKindName(slot.kind, text), eyebrow: null };
};

const subtitleOf = (
  slot: SaveSummarySlot,
  headingKind: HeadingKind | null,
  game: SaveInsightsGame,
  text: SaveInsightsText
) => {
  const value = (kind: SaveStatKind) => statValue(slot.stats, kind);
  const parts: string[] = [];
  if (game.tiles === "number" && slot.title) parts.push(slot.title);
  const characterClass = value("characterClass");
  if (characterClass) parts.push(formatStatValue(characterClass, text));
  const characterName = value("characterName");
  if (characterName && headingKind !== "characterName") {
    parts.push(
      text.t("save_insights_playing_as", {
        name: formatStatValue(characterName, text),
      })
    );
  }
  for (const kind of ["location", "objective", "difficulty"] as const) {
    const stat = value(kind);
    if (stat) parts.push(formatStatValue(stat, text));
  }
  const cycle = numericValue(value("newGamePlus"));
  if (cycle !== null && cycle >= 1) {
    parts.push(
      text.t("save_insights_new_game_plus", { cycle: text.number(cycle) })
    );
  }
  if (parts.length === 0 && headingKind === "inGameDay") {
    return text.t("save_insights_in_game_day");
  }
  if (parts.length === 0 && headingKind === null && slot.savedAtMs) {
    return text.date(slot.savedAtMs);
  }
  return parts.length ? parts.join(" · ") : null;
};

const cardStats = (
  slot: SaveSummarySlot,
  profile: SaveStat[],
  headingKind: HeadingKind | null,
  game: SaveInsightsGame,
  text: SaveInsightsText
) => {
  const stats: SaveCardStat[] = [];
  for (const kind of STAT_ROW_KINDS) {
    if (kind === "level" && headingKind === "level") continue;
    const value =
      statValue(slot.stats, kind) ??
      (kind === "achievements" ? statValue(profile, kind) : undefined);
    if (!value) continue;
    const steps =
      value.type === "progress" && value.value.total <= 10 ? value.value : null;
    stats.push({
      kind,
      name: statName(
        kind,
        statOf(slot.stats, kind) ?? statOf(profile, kind),
        text
      ),
      value: formatStatValue(value, text),
      unit: kind === "playtime" ? null : statUnit(kind, game, text),
      steps,
    });
    if (stats.length === MAX_CARD_STATS) break;
  }
  return stats;
};

const footerOf = (
  slot: SaveSummarySlot,
  heading: string,
  game: SaveInsightsGame,
  text: SaveInsightsText
) => {
  const gameTitle =
    game.tiles !== "number" && slot.title && !slot.title.includes(heading)
      ? slot.title
      : null;
  const name = gameTitle ?? slotKindName(slot.kind, text);
  const parts = [name];
  if (slot.savedAtMs) parts.push(text.date(slot.savedAtMs));
  const version = statValue(slot.stats, "gameVersion");
  if (version && headingOf(slot, game, text).kind === null) {
    return text.t("save_insights_game_version", {
      version: formatStatValue(version, text),
    });
  }
  return parts.join(" · ");
};

export const buildSaveCard = (
  summary: SaveSummary,
  game: SaveInsightsGame,
  text: SaveInsightsText,
  selectedSlotId?: string | null
): SaveCardModel | null => {
  const slots = playableSlots(summary);
  const slot =
    slots.find((candidate) => candidate.id === selectedSlotId) ??
    newestSlot(summary);
  if (!slot) return null;
  const { kind, heading, eyebrow } = headingOf(slot, game, text);
  const completion = numericValue(statValue(slot.stats, "completion"));
  const tiles =
    game.tiles && slots.length > 1
      ? orderedTileSlots(summary).map((tileSlot, index) => {
          const level = numericValue(statValue(tileSlot.stats, "level"));
          const name =
            tileSlot.title ?? headingOf(tileSlot, game, text).heading;
          return {
            slotId: tileSlot.id,
            text:
              game.tiles === "level" && level !== null
                ? text.number(level)
                : String(index + 1),
            label:
              game.tiles === "level" && level !== null
                ? text.t("save_insights_character_tile", {
                    name,
                    level: text.number(level),
                  })
                : text.t("save_insights_slot_tile", {
                    number: index + 1,
                    name,
                  }),
          };
        })
      : [];

  return {
    slot,
    heading,
    eyebrow,
    subtitle: subtitleOf(slot, kind, game, text),
    completion: completion === null ? null : Math.round(completion),
    stats: cardStats(slot, summary.profile, kind, game, text),
    footer: footerOf(slot, heading, game, text),
    tiles,
    slotCount: slots.length,
  };
};

export const canShowSaveCard = (summary: SaveSummary | null) =>
  playableSlots(summary).length > 0 || achievementsOnly(summary) !== null;

export const achievementsOnly = (summary: SaveSummary | null) => {
  if (!summary || playableSlots(summary).length > 0) return null;
  const achievements = numericValue(statValue(summary.profile, "achievements"));
  return achievements;
};

export interface SaveConflictRow {
  kind: SaveStatKind;
  name: string;
  local: string;
  remote: string;
  ahead: SaveSide | null;
  delta: string | null;
}

export interface SaveConflictCharacterRow {
  slotId: string;
  name: string;
  local: string;
  remote: string;
  ahead: SaveSide | null;
  delta: string | null;
}

export interface SaveConflictRun {
  side: SaveSide;
  heading: string;
  subtitle: string | null;
  completion: number | null;
  playtime: string | null;
  savedAtMs: number | null;
}

export interface SaveConflictConsequence {
  text: string;
  warn: boolean;
}

export type SaveConflictHeadline =
  | "remote-ahead"
  | "local-ahead"
  | "mixed"
  | "different-runs"
  | "unknown";

export interface SaveConflictModel {
  headline: SaveConflictHeadline;
  samePlaythrough: boolean | null;
  newerButBehind: SaveSide | null;
  rows: SaveConflictRow[];
  characters: SaveConflictCharacterRow[];
  runs: [SaveConflictRun, SaveConflictRun] | null;
  primary: SaveSide | null;
  consequences: Record<SaveSide, SaveConflictConsequence>;
  localSlot: SaveSummarySlot;
  remoteSlot: SaveSummarySlot;
}

const other = (side: SaveSide): SaveSide =>
  side === "local" ? "remote" : "local";

const compareStat = (
  kind: SaveStatKind,
  local: SaveStatValue,
  remote: SaveStatValue,
  text: SaveInsightsText
): { ahead: SaveSide | null; delta: string | null } => {
  if (!FURTHER_KINDS.has(kind)) return { ahead: null, delta: null };
  const localNumber = numericValue(local);
  const remoteNumber = numericValue(remote);
  if (localNumber === null || remoteNumber === null) {
    return { ahead: null, delta: null };
  }
  if (localNumber === remoteNumber) return { ahead: null, delta: null };
  const ahead: SaveSide = localNumber > remoteNumber ? "local" : "remote";
  const delta = Math.abs(localNumber - remoteNumber);
  return {
    ahead,
    delta: formatDelta(kind, ahead === "local" ? local : remote, delta, text),
  };
};

const playtimeOf = (slot: SaveSummarySlot) =>
  numericValue(statValue(slot.stats, "playtime"));

const characterRows = (
  local: SaveSummary,
  remote: SaveSummary,
  text: SaveInsightsText
) => {
  const ids = [
    ...new Set([
      ...playableSlots(local).map((slot) => slot.id),
      ...playableSlots(remote).map((slot) => slot.id),
    ]),
  ].sort((left, right) =>
    left.localeCompare(right, undefined, { numeric: true })
  );
  return ids.map(
    (
      slotId
    ): SaveConflictCharacterRow & {
      levels: Record<SaveSide, number | null>;
      present: Record<SaveSide, boolean>;
    } => {
      const localSlot = playableSlots(local).find((slot) => slot.id === slotId);
      const remoteSlot = playableSlots(remote).find(
        (slot) => slot.id === slotId
      );
      const levelOf = (slot?: SaveSummarySlot) =>
        slot ? numericValue(statValue(slot.stats, "level")) : null;
      const nameOf = (slot?: SaveSummarySlot) => {
        const name = slot && statValue(slot.stats, "characterName");
        return name ? formatStatValue(name, text) : null;
      };
      const levels = { local: levelOf(localSlot), remote: levelOf(remoteSlot) };
      const describe = (
        slot: SaveSummarySlot | undefined,
        level: number | null
      ) =>
        !slot
          ? text.t("save_insights_none")
          : level === null
            ? slotKindName(slot.kind, text)
            : text.t("save_insights_level", { level: text.number(level) });
      let ahead: SaveSide | null = null;
      if (localSlot && !remoteSlot) ahead = "local";
      else if (remoteSlot && !localSlot) ahead = "remote";
      else if (levels.local !== null && levels.remote !== null) {
        if (levels.local > levels.remote) ahead = "local";
        if (levels.remote > levels.local) ahead = "remote";
      }
      const delta =
        ahead && levels.local !== null && levels.remote !== null
          ? text.number(Math.abs(levels.local - levels.remote))
          : null;
      return {
        slotId,
        name: nameOf(localSlot) ?? nameOf(remoteSlot) ?? slotId,
        local: describe(localSlot, levels.local),
        remote: describe(remoteSlot, levels.remote),
        ahead,
        delta,
        levels,
        present: { local: Boolean(localSlot), remote: Boolean(remoteSlot) },
      };
    }
  );
};

const characterConsequence = (
  rows: ReturnType<typeof characterRows>,
  kept: SaveSide,
  text: SaveInsightsText
): SaveConflictConsequence | null => {
  const lost = other(kept);
  const removed = rows.find((row) => row.present[lost] && !row.present[kept]);
  if (removed) {
    return {
      text: text.t("save_insights_removes_character", { name: removed.name }),
      warn: true,
    };
  }
  const demoted = rows.find(
    (row) =>
      row.ahead === lost &&
      row.levels[kept] !== null &&
      row.levels[lost] !== null
  );
  if (demoted) {
    const count = Math.abs(
      (demoted.levels[lost] ?? 0) - (demoted.levels[kept] ?? 0)
    );
    return {
      text: text.t("save_insights_character_loses_levels", {
        name: demoted.name,
        count,
      }),
      warn: true,
    };
  }
  return null;
};

const replaceText = (kept: SaveSide, text: SaveInsightsText) =>
  text.t(
    kept === "local"
      ? "save_insights_replaces_cloud"
      : "save_insights_replaces_local"
  );

export const buildSaveConflict = (
  local: SaveSummary,
  remote: SaveSummary,
  game: SaveInsightsGame,
  text: SaveInsightsText
): SaveConflictModel | null => {
  const localSlot = newestSlot(local);
  const remoteSlot = newestSlot(remote);
  if (!localSlot || !remoteSlot) return null;

  if (game.tiles === "level") {
    const rows = characterRows(local, remote, text);
    const differing = rows.filter((row) => row.local !== row.remote);
    const localAhead = differing.some((row) => row.ahead === "local");
    const remoteAhead = differing.some((row) => row.ahead === "remote");
    const headline: SaveConflictHeadline =
      localAhead && remoteAhead
        ? "mixed"
        : localAhead
          ? "local-ahead"
          : remoteAhead
            ? "remote-ahead"
            : "unknown";
    const consequence = (kept: SaveSide) =>
      characterConsequence(differing, kept, text) ?? {
        text: replaceText(kept, text),
        warn: false,
      };
    return {
      headline,
      samePlaythrough: null,
      newerButBehind: null,
      rows: [],
      characters: differing.map(
        ({ levels: _levels, present: _present, ...row }) => row
      ),
      runs: null,
      primary:
        headline === "local-ahead"
          ? "local"
          : headline === "remote-ahead"
            ? "remote"
            : null,
      consequences: {
        local: consequence("local"),
        remote: consequence("remote"),
      },
      localSlot,
      remoteSlot,
    };
  }

  const samePlaythrough =
    localSlot.playthrough && remoteSlot.playthrough
      ? localSlot.playthrough === remoteSlot.playthrough
      : null;
  const localPlaytime = playtimeOf(localSlot);
  const remotePlaytime = playtimeOf(remoteSlot);

  if (samePlaythrough === false) {
    const run = (side: SaveSide, slot: SaveSummarySlot): SaveConflictRun => {
      const card = buildSaveCard(
        side === "local" ? local : remote,
        game,
        text,
        slot.id
      );
      const playtime = playtimeOf(slot);
      return {
        side,
        heading: card?.heading ?? slotKindName(slot.kind, text),
        subtitle: card?.subtitle ?? null,
        completion: card?.completion ?? null,
        playtime: playtime === null ? null : formatDuration(playtime, text),
        savedAtMs: slot.savedAtMs ?? null,
      };
    };
    const primary: SaveSide | null =
      localPlaytime === null || remotePlaytime === null
        ? null
        : localPlaytime >= remotePlaytime
          ? "local"
          : "remote";
    const replaced = (playtime: number | null, kept: SaveSide) =>
      playtime === null
        ? { text: replaceText(kept, text), warn: false }
        : {
            text: text.t("save_insights_replaces_play", {
              duration: formatDuration(playtime, text),
            }),
            warn: playtime >= LOSS_WARNING_SECONDS,
          };
    return {
      headline: "different-runs",
      samePlaythrough,
      newerButBehind: null,
      rows: [],
      characters: [],
      runs: [run("local", localSlot), run("remote", remoteSlot)],
      primary,
      consequences: {
        local: replaced(remotePlaytime, "local"),
        remote: replaced(localPlaytime, "remote"),
      },
      localSlot,
      remoteSlot,
    };
  }

  const rows: SaveConflictRow[] = [];
  let localAhead = 0;
  let remoteAhead = 0;
  for (const kind of CONFLICT_ROW_KINDS) {
    const localValue = statValue(localSlot.stats, kind);
    const remoteValue = statValue(remoteSlot.stats, kind);
    if (!localValue || !remoteValue) continue;
    const localText = formatStatValue(localValue, text);
    const remoteText = formatStatValue(remoteValue, text);
    if (localText === remoteText) continue;
    const { ahead, delta } = compareStat(kind, localValue, remoteValue, text);
    if (ahead === "local") localAhead += 1;
    if (ahead === "remote") remoteAhead += 1;
    if (rows.length < MAX_CONFLICT_ROWS) {
      rows.push({
        kind,
        name: statName(
          kind,
          statOf(localSlot.stats, kind) ?? statOf(remoteSlot.stats, kind),
          text
        ),
        local: localText,
        remote: remoteText,
        ahead,
        delta,
      });
    }
  }

  let further: SaveSide | null = null;
  if (localAhead > 0 && remoteAhead === 0) further = "local";
  else if (remoteAhead > 0 && localAhead === 0) further = "remote";
  else if (localPlaytime !== null && remotePlaytime !== null) {
    if (localPlaytime > remotePlaytime) further = "local";
    if (remotePlaytime > localPlaytime) further = "remote";
  }
  const headline: SaveConflictHeadline = further
    ? further === "local"
      ? "local-ahead"
      : "remote-ahead"
    : localAhead > 0 && remoteAhead > 0
      ? "mixed"
      : "unknown";
  const newer: SaveSide | null =
    (localSlot.savedAtMs ?? 0) === (remoteSlot.savedAtMs ?? 0)
      ? null
      : (localSlot.savedAtMs ?? 0) > (remoteSlot.savedAtMs ?? 0)
        ? "local"
        : "remote";

  const lostPlaytime = (kept: SaveSide) => {
    if (localPlaytime === null || remotePlaytime === null) return 0;
    return kept === "local"
      ? remotePlaytime - localPlaytime
      : localPlaytime - remotePlaytime;
  };
  const consequence = (kept: SaveSide): SaveConflictConsequence => {
    const lost = lostPlaytime(kept);
    return lost >= LOSS_WARNING_SECONDS
      ? {
          text: text.t("save_insights_loses_play", {
            duration: formatDuration(lost, text),
          }),
          warn: true,
        }
      : { text: replaceText(kept, text), warn: false };
  };

  return {
    headline,
    samePlaythrough,
    newerButBehind: further && newer && newer !== further ? newer : null,
    rows,
    characters: [],
    runs: null,
    primary: further,
    consequences: {
      local: consequence("local"),
      remote: consequence("remote"),
    },
    localSlot,
    remoteSlot,
  };
};

export const sameScene = (left: SaveScene | null, right: SaveScene | null) =>
  left?.id === right?.id && left?.overlay === right?.overlay;
