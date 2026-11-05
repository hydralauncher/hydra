import { OFFICIAL_MESSAGES_PATH } from "@shared";
import type { OfficialUnreadSummary } from "@types";
import { db, levelKeys } from "@main/level";
import { HydraApi } from "../hydra-api";
import { logger } from "../logger";
import { ChatUnreadStore } from "./chat-unread-store";

const FIRST_POLL_MAX_DELAY_MS = 60 * 1000;
const POLL_JITTER_MAX_MS = 10 * 60 * 1000;
const DEFAULT_POLL_SECONDS = 30 * 60;
const MIN_POLL_SECONDS = 60;

const randomDelay = (maximum: number) => Math.floor(Math.random() * maximum);

// A Cloudflare error page once reached the launcher as API data, so the shape
// is checked before it can touch the badge.
export const isOfficialUnreadSummary = (
  value: unknown
): value is OfficialUnreadSummary => {
  const summary = value as Partial<OfficialUnreadSummary> | null;

  return (
    typeof summary === "object" &&
    summary !== null &&
    Number.isSafeInteger(summary.unreadCount) &&
    (summary.unreadCount as number) >= 0 &&
    Number.isFinite(summary.nextPollSeconds)
  );
};

// Official messages have no realtime delivery. Launchers poll with jitter, and
// the server can slow them down through `nextPollSeconds`, because a whole
// fleet reacting at once has taken the API down before.
export class ChatOfficialMessages {
  private static timer: NodeJS.Timeout | null = null;
  private static polling: Promise<void> | null = null;

  /** Starts polling, unless it already runs. */
  public static start() {
    if (this.timer || this.polling !== null || !HydraApi.isLoggedIn()) return;
    this.schedule(randomDelay(FIRST_POLL_MAX_DELAY_MS));
  }

  public static stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Polls now, for when someone opens the chat window. */
  public static refresh(): Promise<void> {
    if (!HydraApi.isLoggedIn()) return Promise.resolve();

    this.stop();
    this.polling ??= this.poll().finally(() => {
      this.polling = null;
    });

    return this.polling;
  }

  public static async markRead(seq: number) {
    const generation = ChatUnreadStore.getGeneration();

    try {
      await HydraApi.post(`${OFFICIAL_MESSAGES_PATH}/read`, { upToSeq: seq });
      ChatUnreadStore.clearOfficialUnread(generation);
      return true;
    } catch (error) {
      logger.error("Failed to mark official messages as read", error);
      return false;
    }
  }

  private static schedule(delay: number) {
    this.stop();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refresh();
    }, delay);
  }

  private static async poll() {
    const generation = ChatUnreadStore.getGeneration();
    const readMark = ChatUnreadStore.getOfficialReadMark();
    let nextPollSeconds = DEFAULT_POLL_SECONDS;

    try {
      const language = await db
        .get<string, string>(levelKeys.language, { valueEncoding: "utf8" })
        .catch(() => "en");
      const summary = await HydraApi.get<unknown>(
        `${OFFICIAL_MESSAGES_PATH}/unread`,
        { language }
      );

      if (isOfficialUnreadSummary(summary)) {
        ChatUnreadStore.applyOfficialPoll(
          summary.unreadCount,
          generation,
          readMark
        );
        nextPollSeconds = summary.nextPollSeconds;
      } else {
        logger.error("Unexpected official messages response");
      }
    } catch (error) {
      logger.error("Failed to poll official messages", error);
    }

    if (!HydraApi.isLoggedIn()) return;

    // A sign-in during the poll starts its session like any other sign-in.
    this.schedule(
      generation === ChatUnreadStore.getGeneration()
        ? Math.max(nextPollSeconds, MIN_POLL_SECONDS) * 1000 +
            randomDelay(POLL_JITTER_MAX_MS)
        : randomDelay(FIRST_POLL_MAX_DELAY_MS)
    );
  }
}
