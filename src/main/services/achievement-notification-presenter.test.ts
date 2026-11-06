import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AchievementNotificationRequest } from "@types";
import type {
  AchievementNotificationHost,
  AchievementNotificationPresenterDependencies,
} from "./achievement-notification-presenter.js";
import { AchievementNotificationPresenter } from "./achievement-notification-presenter.js";

class FakeHost implements AchievementNotificationHost {
  public readonly webContentsId = 42;
  public loadCount = 0;
  public showInactiveCount = 0;
  public visible = true;
  public windowCalls: string[] = [];
  public failStartSend = false;
  public hideCount = 0;
  public destroyCount = 0;
  public destroyed = false;
  public positions: string[] = [];
  public contentProtection: boolean[] = [];
  public messages: Array<{ channel: string; args: unknown[] }> = [];
  private failureListener: ((reason: string) => void) | null = null;

  public async load(): Promise<void> {
    this.loadCount += 1;
  }

  public send(channel: string, ...args: unknown[]): void {
    if (this.failStartSend && channel === "start-achievement-notification") {
      throw new Error("start send failed");
    }
    this.messages.push({ channel, args });
  }

  public async setPosition(position: string): Promise<void> {
    this.positions.push(position);
  }

  public setContentProtection(isProtected: boolean): void {
    this.contentProtection.push(isProtected);
  }

  public showInactive(): void {
    this.showInactiveCount += 1;
    this.windowCalls.push("showInactive");
  }

  public isVisible(): boolean {
    this.windowCalls.push("isVisible");
    return this.visible;
  }

  public hide(): void {
    this.hideCount += 1;
  }

  public destroy(): void {
    this.destroyCount += 1;
    this.destroyed = true;
  }

  public isDestroyed(): boolean {
    return this.destroyed;
  }

  public onFailure(listener: (reason: string) => void): void {
    this.failureListener = listener;
  }

  public fail(reason: string): void {
    this.failureListener?.(reason);
  }
}

class PresenterHarness {
  public readonly host = new FakeHost();
  public readonly timers = new Map<ReturnType<typeof setTimeout>, () => void>();
  public readonly errors: string[] = [];
  public createCount = 0;

  public readonly presenter = new AchievementNotificationPresenter(
    this.dependencies()
  );

  public async flush(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  public latestPreparedRequest(): { id: string; batchId: string } {
    const message = this.host.messages.findLast(
      ({ channel }) => channel === "prepare-achievement-notification"
    );
    assert.ok(message);
    return message.args[0] as { id: string; batchId: string };
  }

  public latestPreparedRequestId(): string {
    return this.latestPreparedRequest().id;
  }

  public async prepareAchievement(fallback?: () => void): Promise<string> {
    this.presenter.enqueueAchievements(
      "top-left",
      [achievement("first")],
      fallback
    );
    await this.flush();
    this.presenter.handleRendererEvent(this.host.webContentsId, {
      type: "host-ready",
    });
    await this.flush();
    return this.latestPreparedRequestId();
  }

  public async prepareAchievementBatch(
    fallback: (
      requests: AchievementNotificationRequest[],
      soundPlayed: boolean
    ) => void
  ): Promise<{ id: string; batchId: string }> {
    this.presenter.enqueueAchievements(
      "top-left",
      [achievement("first"), achievement("second")],
      fallback
    );
    await this.flush();
    this.presenter.handleRendererEvent(this.host.webContentsId, {
      type: "host-ready",
    });
    await this.flush();

    const first = this.latestPreparedRequest();
    await this.contentReady(first.id);
    return first;
  }

  public async contentReady(requestId: string): Promise<void> {
    this.presenter.handleRendererEvent(this.host.webContentsId, {
      type: "content-ready",
      requestId,
    });
    await this.flush();
  }

  public runLatestTimer(): void {
    const timer = Array.from(this.timers.entries()).at(-1);
    assert.ok(timer);
    this.timers.delete(timer[0]);
    timer[1]();
  }

  private dependencies(): AchievementNotificationPresenterDependencies {
    let timerSequence = 0;

    return {
      createHost: async () => {
        this.createCount += 1;
        return this.host;
      },
      setTimeout: (callback) => {
        timerSequence += 1;
        const handle = timerSequence as unknown as ReturnType<
          typeof setTimeout
        >;
        this.timers.set(handle, callback);
        return handle;
      },
      clearTimeout: (handle) => {
        this.timers.delete(handle);
      },
      log: () => {},
      logError: (message) => this.errors.push(message),
    };
  }
}

const achievement = (title: string) => ({
  title,
  iconUrl: `https://example.com/${title}.png`,
  isHidden: false,
  isRare: false,
  isPlatinum: false,
});

describe("AchievementNotificationPresenter", () => {
  it("shows the host and starts playback immediately after content readiness", async () => {
    const harness = new PresenterHarness();

    assert.equal(harness.createCount, 0);
    harness.presenter.enqueueAchievements("top-left", [achievement("first")]);
    await harness.flush();

    assert.equal(harness.createCount, 1);
    assert.equal(harness.host.loadCount, 1);
    assert.equal(harness.host.showInactiveCount, 0);

    harness.presenter.handleRendererEvent(harness.host.webContentsId, {
      type: "host-ready",
    });
    await harness.flush();

    assert.equal(harness.host.showInactiveCount, 0);
    const requestId = harness.latestPreparedRequestId();
    assert.equal(
      harness.host.messages.at(-1)?.channel,
      "prepare-achievement-notification"
    );

    harness.presenter.handleRendererEvent(harness.host.webContentsId, {
      type: "content-ready",
      requestId,
    });
    await harness.flush();

    assert.equal(harness.host.showInactiveCount, 1);
    assert.deepEqual(harness.host.messages.at(-1), {
      channel: "start-achievement-notification",
      args: [requestId, true],
    });
  });

  it("forwards the window visibility when starting playback", async () => {
    const harness = new PresenterHarness();
    harness.host.visible = false;

    const requestId = await harness.prepareAchievement();
    await harness.contentReady(requestId);

    assert.deepEqual(harness.host.windowCalls, ["showInactive", "isVisible"]);
    assert.deepEqual(harness.host.messages.at(-1), {
      channel: "start-achievement-notification",
      args: [requestId, false],
    });
  });

  it("applies content protection to screenshot notifications", async () => {
    const harness = new PresenterHarness();

    harness.presenter.enqueueScreenshot("top-left", achievement("shot"));
    await harness.flush();
    harness.presenter.handleRendererEvent(harness.host.webContentsId, {
      type: "host-ready",
    });
    await harness.flush();

    const requestId = harness.latestPreparedRequestId();
    await harness.contentReady(requestId);

    assert.deepEqual(harness.host.contentProtection, [true]);
  });

  it("does not apply content protection to achievement notifications", async () => {
    const harness = new PresenterHarness();

    const requestId = await harness.prepareAchievement();
    await harness.contentReady(requestId);

    assert.deepEqual(harness.host.contentProtection, [false]);
  });

  it("reuses one host for a burst and destroys it after the queue drains", async () => {
    const harness = new PresenterHarness();
    harness.presenter.enqueueAchievements("top-left", [
      achievement("first"),
      achievement("second"),
    ]);
    await harness.flush();

    harness.presenter.handleRendererEvent(harness.host.webContentsId, {
      type: "host-ready",
    });
    await harness.flush();
    const firstId = harness.latestPreparedRequestId();
    harness.presenter.handleRendererEvent(harness.host.webContentsId, {
      type: "content-ready",
      requestId: firstId,
    });
    await harness.flush();
    harness.presenter.handleRendererEvent(harness.host.webContentsId, {
      type: "finished",
      requestId: firstId,
    });
    await harness.flush();

    const secondId = harness.latestPreparedRequestId();
    assert.notEqual(secondId, firstId);
    assert.equal(harness.createCount, 1);
    assert.equal(harness.host.hideCount, 1);

    harness.presenter.handleRendererEvent(harness.host.webContentsId, {
      type: "content-ready",
      requestId: secondId,
    });
    await harness.flush();
    harness.presenter.handleRendererEvent(harness.host.webContentsId, {
      type: "finished",
      requestId: secondId,
    });

    assert.equal(harness.host.showInactiveCount, 2);
    assert.equal(harness.host.destroyCount, 1);
    assert.equal(harness.createCount, 1);
  });

  it("keeps one batch id across a burst and starts a new batch afterwards", async () => {
    const harness = new PresenterHarness();

    harness.presenter.enqueueAchievements("top-left", [
      achievement("first"),
      achievement("second"),
    ]);
    harness.presenter.enqueueAchievements("top-left", [achievement("third")]);
    await harness.flush();

    harness.presenter.handleRendererEvent(harness.host.webContentsId, {
      type: "host-ready",
    });
    await harness.flush();

    const first = harness.latestPreparedRequest();
    await harness.contentReady(first.id);
    harness.presenter.handleRendererEvent(harness.host.webContentsId, {
      type: "finished",
      requestId: first.id,
    });
    await harness.flush();

    const second = harness.latestPreparedRequest();
    assert.equal(second.batchId, first.batchId);
    assert.notEqual(second.id, first.id);

    await harness.contentReady(second.id);
    harness.presenter.handleRendererEvent(harness.host.webContentsId, {
      type: "finished",
      requestId: second.id,
    });
    await harness.flush();

    const third = harness.latestPreparedRequest();
    assert.notEqual(third.batchId, first.batchId);
  });

  it("ignores duplicate content-ready after playback starts", async () => {
    const harness = new PresenterHarness();

    const requestId = await harness.prepareAchievement();
    await harness.contentReady(requestId);
    harness.presenter.handleRendererEvent(harness.host.webContentsId, {
      type: "content-ready",
      requestId,
    });
    await harness.flush();

    const starts = harness.host.messages.filter(
      ({ channel }) => channel === "start-achievement-notification"
    );
    assert.equal(starts.length, 1);
    assert.deepEqual(starts[0].args, [requestId, true]);
  });

  it("falls back when the renderer reports failure after start", async () => {
    const harness = new PresenterHarness();
    let fallbackCount = 0;

    const requestId = await harness.prepareAchievement(() => {
      fallbackCount += 1;
    });
    await harness.contentReady(requestId);

    harness.presenter.handleRendererEvent(harness.host.webContentsId, {
      type: "failed",
      requestId,
      reason: "notification window did not become visible",
    });
    await harness.flush();

    assert.equal(harness.host.destroyCount, 1);
    assert.equal(fallbackCount, 1);
  });

  it("does not fall back after playback started", async () => {
    const harness = new PresenterHarness();
    let fallbackCount = 0;

    const requestId = await harness.prepareAchievement(() => {
      fallbackCount += 1;
    });
    await harness.contentReady(requestId);
    harness.presenter.handleRendererEvent(harness.host.webContentsId, {
      type: "started",
      requestId,
    });
    await harness.flush();

    harness.runLatestTimer();
    await harness.flush();

    assert.equal(harness.host.destroyCount, 1);
    assert.equal(fallbackCount, 0);
  });

  it("fails closed when the completion watchdog expires", async () => {
    const harness = new PresenterHarness();
    let fallbackCount = 0;

    const requestId = await harness.prepareAchievement(() => {
      fallbackCount += 1;
    });
    await harness.contentReady(requestId);

    harness.runLatestTimer();
    await harness.flush();

    assert.equal(harness.host.destroyCount, 1);
    assert.equal(fallbackCount, 1);
  });

  it("falls back when the start message cannot be sent", async () => {
    const harness = new PresenterHarness();
    let fallbackCount = 0;
    harness.host.failStartSend = true;

    const requestId = await harness.prepareAchievement(() => {
      fallbackCount += 1;
    });
    await harness.contentReady(requestId);

    assert.equal(harness.host.destroyCount, 1);
    assert.equal(fallbackCount, 1);
    assert.equal(
      harness.host.messages.at(-1)?.channel,
      "prepare-achievement-notification"
    );
  });

  it("ignores stale senders and request acknowledgements", async () => {
    const harness = new PresenterHarness();
    harness.presenter.enqueueAchievements("top-left", [achievement("first")]);
    await harness.flush();
    harness.presenter.handleRendererEvent(harness.host.webContentsId, {
      type: "host-ready",
    });
    await harness.flush();
    const requestId = harness.latestPreparedRequestId();

    harness.presenter.handleRendererEvent(999, {
      type: "content-ready",
      requestId,
    });
    harness.presenter.handleRendererEvent(harness.host.webContentsId, {
      type: "content-ready",
      requestId: "stale-request",
    });

    assert.equal(harness.host.showInactiveCount, 0);
    assert.equal(harness.host.destroyCount, 0);
  });

  it("falls back only with unshown achievements after a card finished", async () => {
    const harness = new PresenterHarness();
    let fallbackRequests: AchievementNotificationRequest[] = [];
    let fallbackSoundPlayed = false;

    const first = await harness.prepareAchievementBatch(
      (requests, soundPlayed) => {
        fallbackRequests = requests;
        fallbackSoundPlayed = soundPlayed;
      }
    );
    harness.presenter.handleRendererEvent(harness.host.webContentsId, {
      type: "started",
      requestId: first.id,
    });
    harness.presenter.handleRendererEvent(harness.host.webContentsId, {
      type: "sound-played",
      requestId: first.id,
      batchId: first.batchId,
    });
    harness.presenter.handleRendererEvent(harness.host.webContentsId, {
      type: "finished",
      requestId: first.id,
    });
    await harness.flush();

    harness.host.fail("window failed after first card");
    await harness.flush();

    assert.equal(fallbackRequests.length, 1);
    assert.equal(fallbackSoundPlayed, true);
    assert.equal(
      fallbackRequests[0].type === "achievement"
        ? fallbackRequests[0].achievement.title
        : null,
      "second"
    );
  });

  it("treats a sound confirmation as shown when started is lost", async () => {
    const harness = new PresenterHarness();
    let fallbackRequests: AchievementNotificationRequest[] = [];
    let fallbackSoundPlayed = false;

    const first = await harness.prepareAchievementBatch(
      (requests, soundPlayed) => {
        fallbackRequests = requests;
        fallbackSoundPlayed = soundPlayed;
      }
    );
    harness.presenter.handleRendererEvent(harness.host.webContentsId, {
      type: "sound-played",
      requestId: first.id,
      batchId: first.batchId,
    });

    harness.host.fail("window failed after audio started");
    await harness.flush();

    assert.equal(fallbackRequests.length, 1);
    assert.equal(fallbackSoundPlayed, true);
    assert.equal(
      fallbackRequests[0].type === "achievement"
        ? fallbackRequests[0].achievement.title
        : null,
      "second"
    );
  });

  it("does not suppress fallback sound before audio succeeds", async () => {
    const harness = new PresenterHarness();
    let fallbackSoundPlayed: boolean | null = null;

    const first = await harness.prepareAchievementBatch(
      (_requests, soundPlayed) => {
        fallbackSoundPlayed = soundPlayed;
      }
    );
    harness.presenter.handleRendererEvent(harness.host.webContentsId, {
      type: "started",
      requestId: first.id,
    });

    harness.host.fail("window failed before audio settled");
    await harness.flush();

    assert.equal(fallbackSoundPlayed, false);
  });

  it("accepts a late sound report while the next batch card is preparing", async () => {
    const harness = new PresenterHarness();
    let fallbackSoundPlayed: boolean | null = null;

    const first = await harness.prepareAchievementBatch(
      (_requests, soundPlayed) => {
        fallbackSoundPlayed = soundPlayed;
      }
    );
    harness.presenter.handleRendererEvent(harness.host.webContentsId, {
      type: "started",
      requestId: first.id,
    });
    harness.presenter.handleRendererEvent(harness.host.webContentsId, {
      type: "finished",
      requestId: first.id,
    });
    await harness.flush();

    harness.presenter.handleRendererEvent(harness.host.webContentsId, {
      type: "sound-played",
      requestId: first.id,
      batchId: first.batchId,
    });

    harness.host.fail("window failed while preparing the next card");
    await harness.flush();

    assert.equal(fallbackSoundPlayed, true);
  });

  it("destroys the host and invokes a batch fallback exactly once on failure", async () => {
    const harness = new PresenterHarness();
    let fallbackCount = 0;
    harness.presenter.enqueueAchievements(
      "top-left",
      [achievement("first"), achievement("second")],
      () => {
        fallbackCount += 1;
      }
    );
    await harness.flush();

    harness.host.fail("window unexpectedly received focus");
    harness.host.fail("duplicate failure");
    await harness.flush();

    assert.equal(harness.host.destroyCount, 1);
    assert.equal(fallbackCount, 1);
    assert.equal(harness.errors.length, 1);
  });

  it("fails closed when a readiness watchdog expires", async () => {
    const harness = new PresenterHarness();
    let fallbackCount = 0;
    harness.presenter.enqueueCombined("bottom-right", 2, 5, () => {
      fallbackCount += 1;
    });
    await harness.flush();

    harness.runLatestTimer();
    await harness.flush();

    assert.equal(harness.host.destroyCount, 1);
    assert.equal(fallbackCount, 1);
  });

  it("continues other fallbacks when one throws synchronously", async () => {
    const harness = new PresenterHarness();
    let fallbackCount = 0;

    harness.presenter.enqueueAchievements(
      "top-left",
      [achievement("first")],
      () => {
        throw new Error("fallback failed");
      }
    );
    harness.presenter.enqueueAchievements(
      "top-left",
      [achievement("second")],
      () => {
        fallbackCount += 1;
      }
    );
    await harness.flush();

    harness.host.fail("window failed");
    await harness.flush();

    assert.equal(fallbackCount, 1);
    assert.ok(
      harness.errors.includes("Achievement notification fallback failed")
    );
  });

  it("ignores new work after shutdown", async () => {
    const harness = new PresenterHarness();

    harness.presenter.shutdown();
    harness.presenter.enqueueAchievements("top-left", [achievement("first")]);
    harness.presenter.keepWarm("top-left");
    await harness.flush();

    assert.equal(harness.createCount, 0);
    assert.equal(harness.host.messages.length, 0);
  });

  it("disposes queued work without invoking fallback", async () => {
    const harness = new PresenterHarness();
    let fallbackCount = 0;
    harness.presenter.enqueueAchievements(
      "top-left",
      [achievement("first")],
      () => {
        fallbackCount += 1;
      }
    );
    await harness.flush();

    harness.presenter.dispose();
    harness.presenter.handleRendererEvent(harness.host.webContentsId, {
      type: "host-ready",
    });

    assert.equal(harness.host.destroyCount, 1);
    assert.equal(fallbackCount, 0);
    assert.equal(harness.host.messages.length, 0);
  });
});
