import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  pauseNotificationPseudoAnimations,
  resumeNotificationAnimations,
  type NotificationAnimation,
} from "../../../helpers/notification-animations.js";
import {
  armNotificationAnimations,
  type ArmingScheduler,
} from "./arm-notification-animations.js";

class FakeAnimation implements NotificationAnimation {
  public currentTime: unknown = null;
  public pauseCount = 0;
  public playCount = 0;
  public playState = "running";

  constructor(
    public readonly animationName?: string,
    public readonly effect: object | null = null
  ) {}

  public pause(): void {
    this.pauseCount += 1;
    this.playState = "paused";
  }

  public play(): void {
    this.playCount += 1;
    this.playState = "running";
  }
}

class FakeScheduler implements ArmingScheduler {
  private readonly frames = new Map<number, () => void>();
  private readonly timeouts = new Map<number, () => void>();
  private sequence = 0;

  public requestFrame(callback: () => void): number {
    const handle = this.nextHandle();
    this.frames.set(handle, callback);
    return handle;
  }

  public cancelFrame(handle: number): void {
    this.frames.delete(handle);
  }

  public setTimeout(callback: () => void, _delay: number): number {
    const handle = this.nextHandle();
    this.timeouts.set(handle, callback);
    return handle;
  }

  public clearTimeout(handle: number): void {
    this.timeouts.delete(handle);
  }

  public runFrame(): void {
    const entry = this.frames.entries().next().value;
    assert.ok(entry);
    this.frames.delete(entry[0]);
    entry[1]();
  }

  public runTimeout(): void {
    const entry = this.timeouts.entries().next().value;
    assert.ok(entry);
    this.timeouts.delete(entry[0]);
    entry[1]();
  }

  public get frameCount(): number {
    return this.frames.size;
  }

  public get timeoutCount(): number {
    return this.timeouts.size;
  }

  private nextHandle(): number {
    this.sequence += 1;
    return this.sequence;
  }
}

class FakeCard {
  private index = 0;

  constructor(private readonly batches: FakeAnimation[][]) {}

  public getAnimations(): readonly NotificationAnimation[] {
    const batch = this.batches[this.index] ?? [];
    this.index += 1;
    return batch;
  }
}

describe("armNotificationAnimations", () => {
  it("pauses at zero and resumes after two frames", () => {
    const first = new FakeAnimation();
    const second = new FakeAnimation();
    const card = new FakeCard([
      [first, second],
      [first, second],
    ]);
    const scheduler = new FakeScheduler();
    let armedCount = 0;

    const cancel = armNotificationAnimations({
      card,
      scheduler,
      timeoutMs: 1000,
      onArmed: () => {
        armedCount += 1;
      },
      onTimeout: () => {},
    });

    assert.equal(first.pauseCount, 1);
    assert.equal(second.pauseCount, 1);
    assert.equal(first.currentTime, 0);
    assert.equal(second.currentTime, 0);
    assert.equal(armedCount, 0);

    scheduler.runFrame();
    assert.equal(armedCount, 0);

    scheduler.runFrame();
    assert.equal(first.playCount, 1);
    assert.equal(second.playCount, 1);
    assert.equal(first.currentTime, 0);
    assert.equal(armedCount, 1);
    assert.equal(scheduler.timeoutCount, 0);

    cancel();
  });

  it("reports a timeout without resuming", () => {
    const animation = new FakeAnimation();
    const card = new FakeCard([[animation], [animation]]);
    const scheduler = new FakeScheduler();
    let armedCount = 0;
    let timeoutCount = 0;

    armNotificationAnimations({
      card,
      scheduler,
      timeoutMs: 1000,
      onArmed: () => {
        armedCount += 1;
      },
      onTimeout: () => {
        timeoutCount += 1;
      },
    });

    scheduler.runTimeout();

    assert.equal(animation.playCount, 0);
    assert.equal(armedCount, 0);
    assert.equal(timeoutCount, 1);
    assert.equal(scheduler.frameCount, 0);
  });

  it("resumes animations replaced during arming", () => {
    const initial = new FakeAnimation();
    const replacement = new FakeAnimation();
    const card = new FakeCard([[initial], [replacement]]);
    const scheduler = new FakeScheduler();

    armNotificationAnimations({
      card,
      scheduler,
      timeoutMs: 1000,
      onArmed: () => {},
      onTimeout: () => {},
    });

    scheduler.runFrame();
    scheduler.runFrame();

    assert.equal(initial.playCount, 0);
    assert.equal(replacement.playCount, 1);
    assert.equal(replacement.currentTime, 0);
  });

  it("pauses and resumes only pseudo-element closing animations", () => {
    const pseudo = new FakeAnimation("theme-loop", {
      pseudoElement: "::before",
    });
    const closing = new FakeAnimation("my-exit");
    const transition = new FakeAnimation();
    const card = new FakeCard([[pseudo, closing, transition]]);

    const paused = pauseNotificationPseudoAnimations(card);

    assert.equal(pseudo.pauseCount, 1);
    assert.equal(closing.pauseCount, 0);
    assert.equal(transition.pauseCount, 0);

    resumeNotificationAnimations(paused);

    assert.equal(pseudo.playCount, 1);
    assert.equal(pseudo.currentTime, 0);
    assert.equal(closing.playCount, 0);
    assert.equal(transition.playCount, 0);
  });

  it("leaves animations paused by the theme paused", () => {
    const themed = new FakeAnimation("theme-paused");
    themed.playState = "paused";
    const card = new FakeCard([[themed], [themed]]);
    const scheduler = new FakeScheduler();

    armNotificationAnimations({
      card,
      scheduler,
      timeoutMs: 1000,
      onArmed: () => {},
      onTimeout: () => {},
    });

    scheduler.runFrame();
    scheduler.runFrame();

    assert.equal(themed.pauseCount, 0);
    assert.equal(themed.playCount, 0);
  });

  it("does not resume after cancellation", () => {
    const animation = new FakeAnimation();
    const card = new FakeCard([[animation], [animation]]);
    const scheduler = new FakeScheduler();
    let armedCount = 0;

    const cancel = armNotificationAnimations({
      card,
      scheduler,
      timeoutMs: 1000,
      onArmed: () => {
        armedCount += 1;
      },
      onTimeout: () => {},
    });

    cancel();

    assert.equal(scheduler.frameCount, 0);
    assert.equal(scheduler.timeoutCount, 0);
    assert.equal(animation.playCount, 0);
    assert.equal(armedCount, 0);
  });
});
