import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { resolveImageUrl } from "./resolve-image-url.js";

class FakeImage {
  public static instances: FakeImage[] = [];
  public onload: (() => void) | null = null;
  public onerror: (() => void) | null = null;
  public src = "";

  constructor() {
    FakeImage.instances.push(this);
  }
}

const originalImage = globalThis.Image;

beforeEach(() => {
  FakeImage.instances = [];
  globalThis.Image = FakeImage as unknown as typeof Image;
});

afterEach(() => {
  globalThis.Image = originalImage;
});

const latestImage = () => {
  const image = FakeImage.instances.at(-1);
  assert.ok(image);
  return image;
};

describe("resolveImageUrl", () => {
  it("keeps the source when the image loads before the timeout", async () => {
    const promise = resolveImageUrl("icon", "hydra", 100);

    latestImage().onload?.();

    assert.equal(await promise, "icon");
  });

  it("falls back when the image fails to load", async () => {
    const promise = resolveImageUrl("icon", "hydra", 100);

    latestImage().onerror?.();

    assert.equal(await promise, "hydra");
  });

  it("falls back when the image never loads", { timeout: 1000 }, async () => {
    const promise = resolveImageUrl("icon", "hydra", 10);

    assert.equal(await promise, "hydra");
  });
});
