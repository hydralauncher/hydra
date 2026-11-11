import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowUpIcon,
  CheckIcon,
  ClockIcon,
  CloudArrowDownIcon,
  CloudArrowUpIcon,
  CloudIcon,
  CoinsIcon,
  CrownIcon,
  FlagIcon,
  HeartIcon,
  MapPinIcon,
  MonitorIcon,
  PlusIcon,
  SparkleIcon,
  StarIcon,
  SunIcon,
  TrophyIcon,
  UserIcon,
  WarningCircleIcon,
  type Icon,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

import type { SaveStatKind, SaveSummary } from "@types";
import { formatBytes } from "@shared";
import { Button } from "@renderer/components";

import type { SaveInsightsGame } from "./save-insights-games";
import {
  achievementsOnly,
  buildSaveCard,
  buildSaveConflict,
  sameScene,
  type SaveCardModel,
  type SaveConflictModel,
  type SaveInsightsText,
  type SaveSide,
} from "./save-insights-presentation";
import {
  pixelateHeroImage,
  resolveSceneImage,
  type SaveSceneImage,
} from "./save-scenes";
import "./save-insights.scss";

const STAT_ICONS: Partial<Record<SaveStatKind, Icon>> = {
  level: StarIcon,
  playtime: ClockIcon,
  chapter: FlagIcon,
  inGameDay: SunIcon,
  quest: FlagIcon,
  location: MapPinIcon,
  money: CoinsIcon,
  newGamePlus: PlusIcon,
  characterName: UserIcon,
  reputation: CrownIcon,
  collectibles: SparkleIcon,
  hearts: HeartIcon,
  achievements: TrophyIcon,
  questsCompleted: CheckIcon,
  completion: StarIcon,
};

export type SaveInsightsStatusTone =
  | "neutral"
  | "synced"
  | "outdated"
  | "conflict";

export const useSaveInsightsText = (): SaveInsightsText => {
  const { t, i18n } = useTranslation("game_details");
  const language = i18n.language;
  return useMemo(() => {
    const numberFormat = new Intl.NumberFormat(language);
    const dateFormat = new Intl.DateTimeFormat(language, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    return {
      t: (key, options) => t(key, options) as string,
      label: (key, text) =>
        t(key, { ns: "save_labels", defaultValue: text }) as string,
      number: (value) => numberFormat.format(value),
      date: (ms) => dateFormat.format(ms),
    };
  }, [language, t]);
};

const useSceneImage = (
  scene: SaveSceneImage | null,
  heroImageUrl: string | null,
  hasMapping: boolean
): SaveSceneImage | null => {
  const [fallback, setFallback] = useState<string | null>(null);
  useEffect(() => {
    setFallback(null);
    if (hasMapping || !heroImageUrl) return;
    let cancelled = false;
    void pixelateHeroImage(heroImageUrl).then((image) => {
      if (!cancelled) setFallback(image);
    });
    return () => {
      cancelled = true;
    };
  }, [hasMapping, heroImageUrl]);
  if (scene) return scene;
  return fallback
    ? {
        key: `hero:${heroImageUrl}`,
        image: fallback,
        overlay: null,
        pixelated: true,
      }
    : null;
};

function CompletionRing({ value }: Readonly<{ value: number }>) {
  const { t } = useTranslation("game_details");
  const circumference = 2 * Math.PI * 11;
  const filled = (Math.min(Math.max(value, 0), 100) / 100) * circumference;
  return (
    <span
      className="save-insights__ring"
      title={t("save_insights_stat_completion")}
      role="img"
      aria-label={`${t("save_insights_stat_completion")} ${value}%`}
    >
      <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
        <circle className="save-insights__ring-track" cx="16" cy="16" r="11" />
        <circle
          className="save-insights__ring-value"
          cx="16"
          cy="16"
          r="11"
          strokeDasharray={`${filled} ${circumference}`}
          transform="rotate(-90 16 16)"
        />
      </svg>
      <span aria-hidden="true">{value}</span>
    </span>
  );
}

function Steps({
  current,
  total,
}: Readonly<{ current: number; total: number }>) {
  return (
    <span className="save-insights__steps" aria-hidden="true">
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          className={`save-insights__step ${index < current ? "save-insights__step--filled" : ""}`}
        />
      ))}
    </span>
  );
}

function StatusPill({
  label,
  tone,
}: Readonly<{ label: string; tone: SaveInsightsStatusTone }>) {
  return (
    <span className="save-insights__pill save-insights__pill--status">
      <span className={`save-insights__dot save-insights__dot--${tone}`} />
      {label}
    </span>
  );
}

function SceneLayer({ scene }: Readonly<{ scene: SaveSceneImage }>) {
  return (
    <>
      <img className="save-insights__scene-image" src={scene.image} alt="" />
      {scene.overlay && (
        <img
          className="save-insights__scene-overlay"
          src={scene.overlay}
          alt=""
          aria-hidden="true"
        />
      )}
    </>
  );
}

function SceneBanner({
  scene,
  children,
}: Readonly<{ scene: SaveSceneImage | null; children?: ReactNode }>) {
  if (!scene) return null;
  return (
    <div className="save-insights__banner">
      <SceneLayer scene={scene} />
      {children}
    </div>
  );
}

function SplitSceneBanner({
  local,
  remote,
  children,
}: Readonly<{
  local: SaveSceneImage | null;
  remote: SaveSceneImage | null;
  children?: ReactNode;
}>) {
  const { t } = useTranslation("game_details");
  return (
    <div className="save-insights__banner save-insights__banner--split">
      {(
        [
          ["local", local, MonitorIcon, t("save_insights_this_pc")],
          ["remote", remote, CloudIcon, t("save_insights_cloud")],
        ] as const
      ).map(([side, scene, SideIcon, label]) => (
        <div key={side} className="save-insights__banner-half">
          {scene && <SceneLayer scene={scene} />}
          <span className="save-insights__pill save-insights__pill--side">
            <SideIcon size={12} aria-hidden="true" />
            {label}
          </span>
        </div>
      ))}
      {children}
    </div>
  );
}

function CardStats({ card }: Readonly<{ card: SaveCardModel }>) {
  if (card.stats.length === 0) return null;
  return (
    <div className="save-insights__stats">
      {card.stats.map((stat) => {
        const StatIcon = STAT_ICONS[stat.kind] ?? StarIcon;
        return (
          <span
            key={stat.kind}
            className="save-insights__stat"
            title={stat.name}
          >
            {stat.steps ? (
              <Steps current={stat.steps.current} total={stat.steps.total} />
            ) : (
              <StatIcon size={16} aria-hidden="true" />
            )}
            {stat.value}
            {stat.unit && (
              <span className="save-insights__stat-unit">{stat.unit}</span>
            )}
          </span>
        );
      })}
    </div>
  );
}

function CardHeading({
  card,
  selectedSlotId,
  onSelectSlot,
}: Readonly<{
  card: SaveCardModel;
  selectedSlotId: string;
  onSelectSlot: (slotId: string) => void;
}>) {
  const { t } = useTranslation("game_details");
  return (
    <div className="save-insights__heading-row">
      <div className="save-insights__heading">
        {card.eyebrow && (
          <span className="save-insights__eyebrow">
            <FlagIcon size={12} aria-hidden="true" />
            {card.eyebrow}
          </span>
        )}
        <strong>{card.heading}</strong>
        {card.subtitle && <span>{card.subtitle}</span>}
      </div>
      {card.tiles.length > 0 && (
        <div
          className="save-insights__tiles"
          role="group"
          aria-label={t("save_insights_slots")}
        >
          {card.tiles.map((tile) => (
            <button
              key={tile.slotId}
              type="button"
              aria-label={tile.label}
              aria-pressed={tile.slotId === selectedSlotId}
              className={`save-insights__tile ${tile.slotId === selectedSlotId ? "save-insights__tile--selected" : ""}`}
              onClick={() => onSelectSlot(tile.slotId)}
            >
              {tile.text}
            </button>
          ))}
        </div>
      )}
      {card.tiles.length === 0 && card.completion !== null && (
        <CompletionRing value={card.completion} />
      )}
    </div>
  );
}

interface SaveInsightCardProps {
  summary: SaveSummary;
  game: SaveInsightsGame;
  heroImageUrl: string | null;
  statusLabel: string;
  statusTone: SaveInsightsStatusTone;
  fileCount: number;
  totalSizeBytes: number;
  updatedAt: string;
  isBusy: boolean;
  onOpenFileBrowser: () => void;
  action: ReactNode;
}

export function SaveInsightCard({
  summary,
  game,
  heroImageUrl,
  statusLabel,
  statusTone,
  fileCount,
  totalSizeBytes,
  updatedAt,
  isBusy,
  onOpenFileBrowser,
  action,
}: Readonly<SaveInsightCardProps>) {
  const { t } = useTranslation("game_details");
  const text = useSaveInsightsText();
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const card = buildSaveCard(summary, game, text, selectedSlotId);
  const achievements = achievementsOnly(summary);
  const mappedScene =
    card && game.scene ? resolveSceneImage(game.scene(card.slot)) : null;
  const scene = useSceneImage(
    mappedScene,
    card ? heroImageUrl : null,
    Boolean(game.scene)
  );

  const filesButton = (
    <button
      type="button"
      className="save-insights__files-button"
      onClick={onOpenFileBrowser}
      disabled={isBusy}
    >
      {card
        ? t("save_insights_saves_count", { count: card.slotCount })
        : t("cloud_save_v2_file_count", { count: fileCount })}
      <span aria-hidden="true">·</span>
      {formatBytes(totalSizeBytes)}
    </button>
  );

  if (!card) {
    if (achievements === null) return null;
    return (
      <article className="save-insights save-insights--compact">
        <div className="save-insights__body">
          <div className="save-insights__heading-row save-insights__heading-row--start">
            <span className="save-insights__badge">
              <TrophyIcon size={20} aria-hidden="true" />
            </span>
            <div className="save-insights__heading">
              <strong>
                {t("save_insights_achievements_count", {
                  count: achievements,
                  formatted: text.number(achievements),
                })}
              </strong>
              <span>{t("save_insights_achievements_unlocked")}</span>
            </div>
            <StatusPill label={statusLabel} tone={statusTone} />
          </div>
          <div className="save-insights__footer">
            <span>
              {Number.isFinite(Date.parse(updatedAt))
                ? text.date(Date.parse(updatedAt))
                : null}
            </span>
            {filesButton}
          </div>
          {action}
        </div>
      </article>
    );
  }

  return (
    <article className="save-insights">
      <SceneBanner scene={scene}>
        <StatusPill label={statusLabel} tone={statusTone} />
      </SceneBanner>
      <div className="save-insights__body">
        {!scene && (
          <div className="save-insights__inline-status">
            <StatusPill label={statusLabel} tone={statusTone} />
          </div>
        )}
        <CardHeading
          card={card}
          selectedSlotId={card.slot.id}
          onSelectSlot={setSelectedSlotId}
        />
        <CardStats card={card} />
        <div className="save-insights__footer">
          <span>{card.footer}</span>
          {filesButton}
        </div>
        {action}
      </div>
    </article>
  );
}

function SideLabel({
  side,
  savedAtMs,
}: Readonly<{ side: SaveSide; savedAtMs: number | null | undefined }>) {
  const { t } = useTranslation("game_details");
  const text = useSaveInsightsText();
  const SideIcon = side === "local" ? MonitorIcon : CloudIcon;
  const name = t(
    side === "local" ? "save_insights_this_pc" : "save_insights_cloud"
  );
  return (
    <span className="save-insights__side-label">
      <SideIcon size={14} aria-hidden="true" />
      {savedAtMs ? `${name} · ${text.date(savedAtMs)}` : name}
    </span>
  );
}

function AheadMark({ delta }: Readonly<{ delta: string | null }>) {
  return (
    <span className="save-insights__delta">
      <ArrowUpIcon size={11} weight="bold" aria-hidden="true" />
      {delta}
    </span>
  );
}

function ConflictRows({ conflict }: Readonly<{ conflict: SaveConflictModel }>) {
  const valueClass = (side: SaveSide, ahead: SaveSide | null) =>
    ahead === null
      ? "save-insights__value"
      : ahead === side
        ? "save-insights__value save-insights__value--ahead"
        : "save-insights__value save-insights__value--behind";

  const rows =
    conflict.characters.length > 0
      ? conflict.characters.map((row) => ({
          key: row.slotId,
          icon: UserIcon,
          name: row.name,
          local: row.local,
          remote: row.remote,
          ahead: row.ahead,
          delta: row.delta,
        }))
      : conflict.rows.map((row) => ({
          key: row.kind,
          icon: STAT_ICONS[row.kind] ?? StarIcon,
          name: row.name,
          local: row.local,
          remote: row.remote,
          ahead: row.ahead,
          delta: row.delta,
        }));
  if (rows.length === 0) return null;

  return (
    <div className="save-insights__table" role="table">
      <div className="save-insights__table-head" role="row">
        <span role="columnheader" />
        <span role="columnheader">
          <SideLabel side="local" savedAtMs={conflict.localSlot.savedAtMs} />
        </span>
        <span role="columnheader">
          <SideLabel side="remote" savedAtMs={conflict.remoteSlot.savedAtMs} />
        </span>
      </div>
      {rows.map((row) => {
        const RowIcon = row.icon;
        return (
          <div key={row.key} className="save-insights__table-row" role="row">
            <span className="save-insights__row-name" role="rowheader">
              <RowIcon size={16} aria-hidden="true" />
              {row.name}
            </span>
            {(["local", "remote"] as const).map((side) => (
              <span
                key={side}
                className={valueClass(side, row.ahead)}
                role="cell"
              >
                {row[side]}
                {row.ahead === side && row.delta && (
                  <AheadMark delta={row.delta} />
                )}
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function RunCards({ conflict }: Readonly<{ conflict: SaveConflictModel }>) {
  if (!conflict.runs) return null;
  return (
    <div className="save-insights__runs">
      {conflict.runs.map((run) => (
        <div
          key={run.side}
          className={`save-insights__run ${conflict.primary === run.side ? "save-insights__run--strong" : ""}`}
        >
          <SideLabel side={run.side} savedAtMs={run.savedAtMs} />
          <div className="save-insights__heading-row">
            <div className="save-insights__heading">
              <strong>{run.heading}</strong>
              {run.subtitle && <span>{run.subtitle}</span>}
            </div>
            {run.completion !== null && (
              <CompletionRing value={run.completion} />
            )}
          </div>
          {run.playtime && (
            <span className="save-insights__stat">
              <ClockIcon size={16} aria-hidden="true" />
              {run.playtime}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

const HEADLINE_KEYS: Record<SaveConflictModel["headline"], string> = {
  "remote-ahead": "save_insights_conflict_remote_ahead",
  "local-ahead": "save_insights_conflict_local_ahead",
  mixed: "save_insights_conflict_mixed",
  "different-runs": "save_insights_conflict_different_runs",
  unknown: "save_insights_conflict_unknown",
};

interface SaveInsightConflictProps {
  local: SaveSummary;
  remote: SaveSummary;
  game: SaveInsightsGame;
  heroImageUrl: string | null;
  statusLabel: string;
  isBusy: boolean;
  onResolveConflict: (side: SaveSide) => void;
  onOpenFileBrowser: () => void;
}

export function SaveInsightConflict({
  local,
  remote,
  game,
  heroImageUrl,
  statusLabel,
  isBusy,
  onResolveConflict,
  onOpenFileBrowser,
}: Readonly<SaveInsightConflictProps>) {
  const { t } = useTranslation("game_details");
  const text = useSaveInsightsText();
  const conflict = buildSaveConflict(local, remote, game, text);
  const localScene =
    conflict && game.scene ? game.scene(conflict.localSlot) : null;
  const remoteScene =
    conflict && game.scene ? game.scene(conflict.remoteSlot) : null;
  const scene = useSceneImage(
    resolveSceneImage(remoteScene ?? localScene),
    conflict ? heroImageUrl : null,
    Boolean(game.scene)
  );
  if (!conflict) return null;

  const split = !sameScene(localScene, remoteScene);
  const status = <StatusPill label={statusLabel} tone="conflict" />;
  const subtitle =
    conflict.headline === "different-runs"
      ? t("save_insights_conflict_different_runs_description")
      : conflict.headline === "mixed" && conflict.characters.length > 0
        ? t("save_insights_conflict_mixed_characters")
        : conflict.newerButBehind
          ? t(
              conflict.newerButBehind === "local"
                ? "save_insights_conflict_local_newer_but_behind"
                : "save_insights_conflict_remote_newer_but_behind"
            )
          : null;

  const choice = (side: SaveSide) => {
    const consequence = conflict.consequences[side];
    const primary = conflict.primary === side;
    return (
      <div className="save-insights__choice">
        <Button
          theme={primary ? "primary" : "outline"}
          onClick={() => onResolveConflict(side)}
          disabled={isBusy}
        >
          {side === "local" ? (
            <CloudArrowUpIcon size={20} />
          ) : (
            <CloudArrowDownIcon size={20} />
          )}
          {t(
            side === "local"
              ? "cloud_save_v2_keep_local"
              : "cloud_save_v2_keep_remote"
          )}
        </Button>
        <span
          className={`save-insights__consequence ${consequence.warn ? "save-insights__consequence--warn" : ""}`}
        >
          {consequence.warn && (
            <WarningCircleIcon size={13} aria-hidden="true" />
          )}
          {consequence.text}
        </span>
      </div>
    );
  };

  return (
    <article className="save-insights save-insights--conflict">
      {split ? (
        <SplitSceneBanner
          local={resolveSceneImage(localScene)}
          remote={resolveSceneImage(remoteScene)}
        >
          {status}
        </SplitSceneBanner>
      ) : (
        <SceneBanner scene={scene}>{status}</SceneBanner>
      )}
      <div className="save-insights__body save-insights__body--conflict">
        {!scene && !split && (
          <div className="save-insights__inline-status">{status}</div>
        )}
        <div className="save-insights__headline">
          {conflict.headline === "different-runs" && (
            <WarningCircleIcon
              className="save-insights__headline-icon"
              size={20}
              aria-hidden="true"
            />
          )}
          <div className="save-insights__heading">
            <strong>{t(HEADLINE_KEYS[conflict.headline])}</strong>
            {subtitle && <span>{subtitle}</span>}
            {!subtitle && conflict.samePlaythrough && (
              <span className="save-insights__same-run">
                <CheckIcon size={14} weight="bold" aria-hidden="true" />
                {t("save_insights_conflict_same_run")}
              </span>
            )}
          </div>
        </div>
        <ConflictRows conflict={conflict} />
        <RunCards conflict={conflict} />
        <div className="save-insights__choices">
          {choice("local")}
          {choice("remote")}
        </div>
        <div className="save-insights__footer save-insights__footer--end">
          <button
            type="button"
            className="save-insights__files-button"
            onClick={onOpenFileBrowser}
            disabled={isBusy}
          >
            {t("cloud_save_v2_view_conflicts")}
          </button>
        </div>
      </div>
    </article>
  );
}
