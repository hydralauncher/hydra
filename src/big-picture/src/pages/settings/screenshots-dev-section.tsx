import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  LocalScreenshot,
  ScreenshotsDevGame,
  ScreenshotsDevResult,
} from "@types";
import { logger } from "@renderer/logger";

import {
  Button,
  Checkbox,
  DropdownSelect,
  HorizontalFocusGroup,
  VerticalFocusGroup,
  type DropdownSelectOption,
} from "../../components";
import type { FocusOverrideTarget } from "../../services";
import {
  SCREENSHOTS_DEV_ENTRY_FOCUS_ID,
  buildRowNavigation,
} from "./screenshots-section";
import { SettingsSection } from "./settings-section";

const SCREENSHOTS_DEV_FOCUS_IDS = {
  game: SCREENSHOTS_DEV_ENTRY_FOCUS_ID,
  burstCount: "screenshots-dev-burst-count",
  signedOut: "screenshots-dev-signed-out",
  adult: "screenshots-dev-adult",
  capture: "screenshots-dev-capture",
  burst: "screenshots-dev-burst",
  closeGame: "screenshots-dev-close-game",
  record: "screenshots-dev-record",
  bigPictureReview: "screenshots-dev-big-picture-review",
  deleteCaptures: "screenshots-dev-delete-captures",
} as const;

const ids = SCREENSHOTS_DEV_FOCUS_IDS;
const SECTION_REGION_ID = "screenshots-dev-section";
const CUSTOM_GAME_VALUE = "custom";
const PATTERN = { kind: "pattern" as const, width: 1920, height: 1080 };
const BURST_COUNTS = [2, 3, 4, 5, 6, 7, 8];
const DEFAULT_BURST_COUNT = 6;
const BLOCK_TARGET: FocusOverrideTarget = { type: "block" };

const getGameValue = (game: Pick<ScreenshotsDevGame, "shop" | "objectId">) =>
  `${game.shop}:${game.objectId}`;

const isAwaitingReview = (screenshot: LocalScreenshot) =>
  screenshot.state === "local" || screenshot.state === "reviewing";

interface ScreenshotsDevSectionProps {
  upFocusId: string | null;
}

export default function ScreenshotsDevSection({
  upFocusId,
}: Readonly<ScreenshotsDevSectionProps>) {
  const { t } = useTranslation("screenshots_dev");
  const devApi = globalThis.window.electron.screenshotsDev;
  const [games, setGames] = useState<ScreenshotsDevGame[]>([]);
  const [gameValue, setGameValue] = useState(CUSTOM_GAME_VALUE);
  const [burstCount, setBurstCount] = useState(DEFAULT_BURST_COUNT);
  const [signedOut, setSignedOut] = useState(false);
  const [adult, setAdult] = useState(false);
  const [screenshots, setScreenshots] = useState<LocalScreenshot[]>([]);
  const [clientId, setClientId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const refreshGames = useCallback(() => {
    void devApi
      ?.listGames()
      .then(setGames)
      .catch((error) => logger.error("Failed to list dev games", error));
  }, [devApi]);

  useEffect(() => {
    refreshGames();
    void globalThis.window.electron.getLocalScreenshots().then(setScreenshots);
    return globalThis.window.electron.onLocalScreenshotsChange(setScreenshots);
  }, [refreshGames]);

  const selectedGame = useMemo(
    () =>
      games.find((game) => getGameValue(game) === gameValue) ?? {
        shop: "custom" as const,
        objectId: "dev-custom-game",
        title: t("custom_game_default_title"),
        isRunning: false,
      },
    [gameValue, games, t]
  );

  const reviewable = useMemo(
    () => screenshots.filter(isAwaitingReview),
    [screenshots]
  );
  const selectedScreenshot =
    reviewable.find((screenshot) => screenshot.clientId === clientId) ??
    reviewable[0] ??
    null;

  const rows = useMemo(
    () =>
      [
        [ids.game, ids.burstCount],
        [ids.signedOut],
        [ids.adult],
        [ids.capture, ids.burst, ids.closeGame],
        selectedScreenshot ? [ids.record] : [],
        selectedScreenshot
          ? [ids.bigPictureReview, ids.deleteCaptures]
          : [ids.deleteCaptures],
      ].filter((row) => row.length > 0),
    [selectedScreenshot]
  );
  const navigation = useMemo(
    () =>
      buildRowNavigation(
        rows,
        upFocusId ? { type: "item", itemId: upFocusId } : BLOCK_TARGET,
        BLOCK_TARGET
      ),
    [rows, upFocusId]
  );

  if (!devApi) return null;

  const runTool = async (task: () => Promise<ScreenshotsDevResult>) => {
    setIsBusy(true);
    try {
      const result = await task();
      setMessage(
        result.ok
          ? t("result_ok", { count: result.count ?? 1 })
          : t(`error_${result.error ?? "failed"}`)
      );
    } catch (error) {
      logger.error("Screenshot dev tool failed", error);
      setMessage(t("error_failed"));
    } finally {
      setIsBusy(false);
      refreshGames();
    }
  };

  const captureRequest = {
    game: {
      shop: selectedGame.shop,
      objectId: selectedGame.objectId,
      title: selectedGame.title,
    },
    image: PATTERN,
    signedOut,
    adult,
  };

  const reviewSessionIds = () => {
    if (!selectedScreenshot) return [];
    const sessionIds = reviewable
      .filter(
        (screenshot) =>
          screenshot.gameSessionId === selectedScreenshot.gameSessionId
      )
      .map((screenshot) => screenshot.clientId);
    return sessionIds.length ? sessionIds : [selectedScreenshot.clientId];
  };

  const gameOptions: DropdownSelectOption[] = [
    { value: CUSTOM_GAME_VALUE, label: t("custom_game") },
    ...games.map((game) => ({
      value: getGameValue(game),
      label: game.isRunning
        ? t("game_running", { title: game.title })
        : game.title,
    })),
  ];
  const burstOptions: DropdownSelectOption[] = BURST_COUNTS.map((count) => ({
    value: String(count),
    label: t("burst", { count }),
  }));
  const recordOptions: DropdownSelectOption[] = reviewable.map(
    (screenshot) => ({
      value: screenshot.clientId,
      label: t("record_label", {
        title: screenshot.gameTitle,
        date: new Date(screenshot.capturedAt).toLocaleString(),
        state: screenshot.state,
      }),
    })
  );

  return (
    <SettingsSection title={t("title")} description={t("description")}>
      <VerticalFocusGroup regionId={SECTION_REGION_ID} asChild>
        <div className="screenshot-settings">
          <div className="screenshot-settings__row">
            <span className="screenshot-settings__label">
              {t("capture_group")}
            </span>
            <span className="screenshot-settings__hint">
              {t("capture_hint")}
            </span>
            <HorizontalFocusGroup asChild>
              <div className="screenshot-settings__controls">
                <DropdownSelect
                  className="screenshot-settings__select"
                  label={t("game")}
                  hideLabel
                  ariaLabel={t("game")}
                  value={gameValue}
                  options={gameOptions}
                  focusId={ids.game}
                  focusNavigationOverrides={navigation[ids.game]}
                  onValueChange={setGameValue}
                />
                <DropdownSelect
                  className="screenshot-settings__select"
                  label={t("burst_count")}
                  hideLabel
                  ariaLabel={t("burst_count")}
                  value={String(burstCount)}
                  options={burstOptions}
                  focusId={ids.burstCount}
                  focusNavigationOverrides={navigation[ids.burstCount]}
                  onValueChange={(value) => setBurstCount(Number(value))}
                />
              </div>
            </HorizontalFocusGroup>
          </div>

          <Checkbox
            block
            label={t("signed_out")}
            checked={signedOut}
            focusId={ids.signedOut}
            navigationOverrides={navigation[ids.signedOut]}
            onChange={setSignedOut}
          />
          <Checkbox
            block
            label={t("adult_game")}
            checked={adult}
            focusId={ids.adult}
            navigationOverrides={navigation[ids.adult]}
            onChange={setAdult}
          />

          <HorizontalFocusGroup asChild>
            <div className="screenshot-settings__controls">
              <Button
                variant="secondary"
                size="small"
                focusId={ids.capture}
                disabled={isBusy}
                focusNavigationOverrides={navigation[ids.capture]}
                onClick={() =>
                  void runTool(() => devApi.capture(captureRequest))
                }
              >
                {t("capture")}
              </Button>
              <Button
                variant="secondary"
                size="small"
                focusId={ids.burst}
                disabled={isBusy}
                focusNavigationOverrides={navigation[ids.burst]}
                onClick={() =>
                  void runTool(() =>
                    devApi.burst({ ...captureRequest, count: burstCount })
                  )
                }
              >
                {t("burst", { count: burstCount })}
              </Button>
              <Button
                variant="secondary"
                size="small"
                focusId={ids.closeGame}
                disabled={isBusy}
                focusNavigationOverrides={navigation[ids.closeGame]}
                onClick={() =>
                  void runTool(() =>
                    devApi.closeGame(selectedGame.shop, selectedGame.objectId)
                  )
                }
              >
                {t("close_game")}
              </Button>
            </div>
          </HorizontalFocusGroup>

          <div className="screenshot-settings__row">
            <span className="screenshot-settings__label">
              {t("record_group")}
            </span>
            {selectedScreenshot ? (
              <DropdownSelect
                className="screenshot-settings__select"
                label={t("record")}
                hideLabel
                ariaLabel={t("record")}
                value={selectedScreenshot.clientId}
                options={recordOptions}
                focusId={ids.record}
                focusNavigationOverrides={navigation[ids.record]}
                onValueChange={setClientId}
              />
            ) : (
              <span className="screenshot-settings__hint">
                {t("no_records")}
              </span>
            )}
            <HorizontalFocusGroup asChild>
              <div className="screenshot-settings__controls">
                {selectedScreenshot ? (
                  <Button
                    variant="secondary"
                    size="small"
                    focusId={ids.bigPictureReview}
                    disabled={isBusy}
                    focusNavigationOverrides={navigation[ids.bigPictureReview]}
                    onClick={() =>
                      void runTool(() =>
                        devApi.bigPictureReview(reviewSessionIds())
                      )
                    }
                  >
                    {t("big_picture_review")}
                  </Button>
                ) : null}
                <Button
                  variant="secondary"
                  size="small"
                  focusId={ids.deleteCaptures}
                  disabled={isBusy}
                  focusNavigationOverrides={navigation[ids.deleteCaptures]}
                  onClick={() => void runTool(() => devApi.deleteCaptures())}
                >
                  {t("delete_dev_captures")}
                </Button>
              </div>
            </HorizontalFocusGroup>
          </div>

          {message ? (
            <span className="screenshot-settings__hint" role="status">
              {message}
            </span>
          ) : null}
        </div>
      </VerticalFocusGroup>
    </SettingsSection>
  );
}
