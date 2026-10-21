import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  Button,
  CheckboxField,
  SelectField,
  TextField,
} from "@renderer/components";
import { logger } from "@renderer/logger";
import { SCREENSHOT_MODERATION_REASON_KEYS } from "@shared";
import type {
  LocalScreenshot,
  ScreenshotInputStatus,
  ScreenshotsDevFeedbackKind,
  ScreenshotsDevGame,
  ScreenshotsDevImageSource,
  ScreenshotsDevModerationOutcome,
  ScreenshotsDevResult,
  ScreenshotsDevUploadFailure,
} from "@types";

import "./settings-screenshots-dev-tools.scss";

const CUSTOM_GAME_VALUE = "custom";
const FILE_SOURCE_VALUE = "file";
const PATTERN_RESOLUTIONS = [
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
  { width: 3840, height: 2160 },
];
const BURST_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8];
const FEEDBACK_KINDS: ScreenshotsDevFeedbackKind[] = [
  "sound",
  "flash",
  "captured",
  "saved_locally",
  "disabled_for_game",
];
const MODERATION_OUTCOMES: ScreenshotsDevModerationOutcome[] = [
  "APPROVED",
  "BLOCKED",
  "WITHHELD",
];
const UPLOAD_FAILURES: ScreenshotsDevUploadFailure[] = [
  "tier_limit",
  "disabled_for_game",
  "limit_reached",
  "game_not_found",
  "network",
  "already_uploaded",
];

const getGameValue = (game: Pick<ScreenshotsDevGame, "shop" | "objectId">) =>
  `${game.shop}:${game.objectId}`;

const getPatternValue = ({
  width,
  height,
}: {
  width: number;
  height: number;
}) => `${width}x${height}`;

export function SettingsScreenshotsDevTools() {
  const { t } = useTranslation("screenshots_dev");
  const { t: tModeration } = useTranslation("screenshots_moderation");
  const devApi = window.electron.screenshotsDev;

  const [games, setGames] = useState<ScreenshotsDevGame[]>([]);
  const [gameValue, setGameValue] = useState(CUSTOM_GAME_VALUE);
  const [customTitle, setCustomTitle] = useState("");
  const [imageValue, setImageValue] = useState(
    getPatternValue(PATTERN_RESOLUTIONS[1])
  );
  const [filePath, setFilePath] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [adult, setAdult] = useState(false);
  const [burstCount, setBurstCount] = useState(6);
  const [screenshots, setScreenshots] = useState<LocalScreenshot[]>([]);
  const [clientId, setClientId] = useState("");
  const [outcome, setOutcome] =
    useState<ScreenshotsDevModerationOutcome>("APPROVED");
  const [reason, setReason] = useState<string>(
    SCREENSHOT_MODERATION_REASON_KEYS[0]
  );
  const [failure, setFailure] =
    useState<ScreenshotsDevUploadFailure>("tier_limit");
  const [inputStatus, setInputStatus] = useState<ScreenshotInputStatus | null>(
    null
  );
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
    void window.electron.getLocalScreenshots().then(setScreenshots);
    void devApi?.inputStatus().then(setInputStatus);
    return window.electron.onLocalScreenshotsChange(setScreenshots);
  }, [devApi, refreshGames]);

  const selectedScreenshot =
    screenshots.find((screenshot) => screenshot.clientId === clientId) ??
    screenshots[0] ??
    null;

  const selectedGame = useMemo(() => {
    const game = games.find(
      (candidate) => getGameValue(candidate) === gameValue
    );
    if (game) return game;
    return {
      shop: "custom" as const,
      objectId: "dev-custom-game",
      title: customTitle.trim() || t("custom_game_default_title"),
      isRunning: false,
    };
  }, [customTitle, gameValue, games, t]);

  const imageSource = useMemo((): ScreenshotsDevImageSource | null => {
    if (imageValue === FILE_SOURCE_VALUE) {
      return filePath ? { kind: "file", path: filePath } : null;
    }
    const resolution =
      PATTERN_RESOLUTIONS.find(
        (candidate) => getPatternValue(candidate) === imageValue
      ) ?? PATTERN_RESOLUTIONS[1];
    return { kind: "pattern", ...resolution };
  }, [filePath, imageValue]);

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

  const captureRequest = () =>
    imageSource
      ? {
          game: {
            shop: selectedGame.shop,
            objectId: selectedGame.objectId,
            title: selectedGame.title,
          },
          image: imageSource,
          signedOut,
          adult,
        }
      : null;

  const handleCapture = () => {
    const request = captureRequest();
    if (!devApi || !request) return;
    void runTool(() => devApi.capture(request));
  };

  const handleBurst = () => {
    const request = captureRequest();
    if (!devApi || !request) return;
    void runTool(() => devApi.burst({ ...request, count: burstCount }));
  };

  const handlePickFile = async () => {
    const { canceled, filePaths } = await window.electron.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp"] }],
    });
    if (!canceled && filePaths[0]) setFilePath(filePaths[0]);
  };

  const handleBigPicture = () => {
    if (!devApi || !selectedScreenshot) return;
    const sessionIds = screenshots
      .filter(
        (screenshot) =>
          screenshot.gameSessionId === selectedScreenshot.gameSessionId &&
          (screenshot.state === "local" || screenshot.state === "reviewing")
      )
      .map((screenshot) => screenshot.clientId);
    const clientIds = sessionIds.includes(selectedScreenshot.clientId)
      ? sessionIds
      : [selectedScreenshot.clientId];
    void runTool(() => devApi.bigPictureReview(clientIds));
  };

  const handleTriggerInput = async () => {
    if (!devApi) return;
    const result = await devApi.triggerInput();
    setInputStatus(result.status);
    setMessage(
      result.triggered ? t("input_triggered") : t("input_not_triggered")
    );
  };

  if (!devApi) return null;

  const gameOptions = [
    {
      key: CUSTOM_GAME_VALUE,
      value: CUSTOM_GAME_VALUE,
      label: t("custom_game"),
    },
    ...games.map((game) => ({
      key: getGameValue(game),
      value: getGameValue(game),
      label: game.isRunning
        ? t("game_running", { title: game.title })
        : game.title,
    })),
  ];

  const imageOptions = [
    ...PATTERN_RESOLUTIONS.map((resolution) => ({
      key: getPatternValue(resolution),
      value: getPatternValue(resolution),
      label: t("pattern", { resolution: getPatternValue(resolution) }),
    })),
    { key: FILE_SOURCE_VALUE, value: FILE_SOURCE_VALUE, label: t("pick_file") },
  ];

  const screenshotOptions = screenshots.map((screenshot) => ({
    key: screenshot.clientId,
    value: screenshot.clientId,
    label: t("record_label", {
      title: screenshot.gameTitle,
      date: new Date(screenshot.capturedAt).toLocaleString(),
      state: screenshot.state,
    }),
  }));

  return (
    <div className="settings-context-panel__group settings-screenshots-dev">
      <h3>{t("title")}</h3>
      <small className="settings-screenshots__hint">{t("description")}</small>

      <section className="settings-screenshots-dev__section">
        <h4>{t("capture_group")}</h4>
        <small className="settings-screenshots__hint">
          {t("capture_hint")}
        </small>

        <SelectField
          label={t("game")}
          value={gameValue}
          options={gameOptions}
          onChange={(event) => setGameValue(event.target.value)}
        />

        {gameValue === CUSTOM_GAME_VALUE && (
          <TextField
            label={t("custom_game_title")}
            placeholder={t("custom_game_default_title")}
            value={customTitle}
            onChange={(event) => setCustomTitle(event.target.value)}
          />
        )}

        <SelectField
          label={t("image_source")}
          value={imageValue}
          options={imageOptions}
          onChange={(event) => setImageValue(event.target.value)}
        />

        {imageValue === FILE_SOURCE_VALUE && (
          <div className="settings-screenshots-dev__row">
            <Button theme="outline" size="small" onClick={handlePickFile}>
              {t("choose_file")}
            </Button>
            <small className="settings-screenshots__hint">
              {filePath ?? t("no_file")}
            </small>
          </div>
        )}

        <CheckboxField
          label={t("signed_out")}
          checked={signedOut}
          onChange={() => setSignedOut((current) => !current)}
        />
        <CheckboxField
          label={t("adult_game")}
          checked={adult}
          onChange={() => setAdult((current) => !current)}
        />

        <SelectField
          label={t("burst_count")}
          value={String(burstCount)}
          options={BURST_COUNTS.map((count) => ({
            key: String(count),
            value: String(count),
            label: String(count),
          }))}
          onChange={(event) => setBurstCount(Number(event.target.value))}
        />

        <div className="settings-screenshots-dev__row">
          <Button
            size="small"
            disabled={isBusy || !imageSource}
            onClick={handleCapture}
          >
            {t("capture")}
          </Button>
          <Button
            size="small"
            theme="outline"
            disabled={isBusy || !imageSource}
            onClick={handleBurst}
          >
            {t("burst", { count: burstCount })}
          </Button>
          <Button
            size="small"
            theme="outline"
            disabled={isBusy}
            onClick={() =>
              void runTool(() =>
                devApi.closeGame(selectedGame.shop, selectedGame.objectId)
              )
            }
          >
            {t("close_game")}
          </Button>
        </div>
      </section>

      <section className="settings-screenshots-dev__section">
        <h4>{t("feedback_group")}</h4>
        <small className="settings-screenshots__hint">
          {t("feedback_hint")}
        </small>
        <div className="settings-screenshots-dev__row">
          {FEEDBACK_KINDS.map((kind) => (
            <Button
              key={kind}
              size="small"
              theme="outline"
              disabled={isBusy}
              onClick={() => void runTool(() => devApi.feedback(kind))}
            >
              {t(`feedback_${kind}`)}
            </Button>
          ))}
        </div>
      </section>

      <section className="settings-screenshots-dev__section">
        <h4>{t("record_group")}</h4>
        <small className="settings-screenshots__hint">{t("record_hint")}</small>

        {screenshotOptions.length === 0 ? (
          <small className="settings-screenshots__hint">
            {t("no_records")}
          </small>
        ) : (
          <SelectField
            label={t("record")}
            value={selectedScreenshot?.clientId ?? ""}
            options={screenshotOptions}
            onChange={(event) => setClientId(event.target.value)}
          />
        )}

        <div className="settings-screenshots-dev__row">
          <Button
            size="small"
            theme="outline"
            disabled={!selectedScreenshot}
            onClick={() =>
              selectedScreenshot &&
              void window.electron.openScreenshotReview(
                selectedScreenshot.clientId
              )
            }
          >
            {t("open_review")}
          </Button>
          <Button
            size="small"
            theme="outline"
            disabled={isBusy || !selectedScreenshot}
            onClick={handleBigPicture}
          >
            {t("big_picture_review")}
          </Button>
        </div>

        <div className="settings-screenshots-dev__row">
          <SelectField
            label={t("moderation_outcome")}
            value={outcome}
            options={MODERATION_OUTCOMES.map((value) => ({
              key: value,
              value,
              label: t(`moderation_${value.toLowerCase()}`),
            }))}
            onChange={(event) =>
              setOutcome(event.target.value as ScreenshotsDevModerationOutcome)
            }
          />
          {outcome === "BLOCKED" && (
            <SelectField
              label={t("moderation_reason")}
              value={reason}
              options={SCREENSHOT_MODERATION_REASON_KEYS.map((value) => ({
                key: value,
                value,
                label: tModeration(value),
              }))}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
          <Button
            size="small"
            theme="outline"
            disabled={isBusy || !selectedScreenshot?.screenshotId}
            onClick={() =>
              selectedScreenshot &&
              void runTool(() =>
                devApi.moderation(selectedScreenshot.clientId, outcome, reason)
              )
            }
          >
            {t("apply_moderation")}
          </Button>
        </div>

        <div className="settings-screenshots-dev__row">
          <SelectField
            label={t("upload_failure")}
            value={failure}
            options={UPLOAD_FAILURES.map((value) => ({
              key: value,
              value,
              label: t(`failure_${value}`),
            }))}
            onChange={(event) =>
              setFailure(event.target.value as ScreenshotsDevUploadFailure)
            }
          />
          <Button
            size="small"
            theme="outline"
            disabled={isBusy || !selectedScreenshot}
            onClick={() =>
              selectedScreenshot &&
              void runTool(() =>
                devApi.uploadFailure(selectedScreenshot.clientId, failure)
              )
            }
          >
            {t("apply_failure")}
          </Button>
        </div>
      </section>

      <section className="settings-screenshots-dev__section">
        <h4>{t("input_group")}</h4>
        <small className="settings-screenshots__hint">{t("input_hint")}</small>
        {inputStatus && (
          <small className="settings-screenshots__hint">
            {t("input_status", {
              active: inputStatus.active ? t("yes") : t("no"),
              keyboard: inputStatus.keyboardBackend,
              gamepad: inputStatus.gamepadBackend,
            })}
          </small>
        )}
        <div className="settings-screenshots-dev__row">
          <Button
            size="small"
            theme="outline"
            onClick={() => void handleTriggerInput()}
          >
            {t("trigger_input")}
          </Button>
        </div>
      </section>

      <section className="settings-screenshots-dev__section">
        <h4>{t("housekeeping_group")}</h4>
        <div className="settings-screenshots-dev__row">
          <Button
            size="small"
            theme="danger"
            disabled={isBusy}
            onClick={() => void runTool(() => devApi.deleteCaptures())}
          >
            {t("delete_dev_captures")}
          </Button>
          <Button
            size="small"
            theme="outline"
            onClick={() => void window.electron.openScreenshotsFolder()}
          >
            {t("open_folder")}
          </Button>
        </div>
      </section>

      {message && (
        <output className="settings-screenshots-dev__result">{message}</output>
      )}
    </div>
  );
}
