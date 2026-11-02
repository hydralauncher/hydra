import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getClientAreaCrop,
  getWindowHandleFromSourceId,
} from "./windows-client-area-crop.js";

describe("Windows client area crop", () => {
  it("removes the title bar and menu of a windowed game", () => {
    const frame = { left: 100, top: 50, right: 1100, bottom: 850 };
    const client = { left: 101, top: 110, right: 1099, bottom: 849 };

    assert.deepEqual(
      getClientAreaCrop(frame, client, { width: 1000, height: 800 }),
      { x: 1, y: 60, width: 998, height: 739 }
    );
  });

  it("scales the crop when the captured frame size differs", () => {
    const frame = { left: 0, top: 0, right: 1000, bottom: 800 };
    const client = { left: 0, top: 60, right: 1000, bottom: 800 };

    assert.deepEqual(
      getClientAreaCrop(frame, client, { width: 2000, height: 1600 }),
      { x: 0, y: 120, width: 2000, height: 1480 }
    );
  });

  it("does not crop borderless or fullscreen windows", () => {
    const bounds = { left: 0, top: 0, right: 1920, bottom: 1080 };

    assert.equal(
      getClientAreaCrop(bounds, bounds, { width: 1920, height: 1080 }),
      null
    );
  });

  it("does not crop without valid bounds", () => {
    assert.equal(
      getClientAreaCrop(
        null,
        { left: 0, top: 0, right: 10, bottom: 10 },
        { width: 10, height: 10 }
      ),
      null
    );
    assert.equal(
      getClientAreaCrop(
        { left: 0, top: 0, right: 10, bottom: 10 },
        { left: 20, top: 20, right: 30, bottom: 30 },
        { width: 10, height: 10 }
      ),
      null
    );
  });

  it("keeps the full window when the crop would remove more than window chrome", () => {
    const frame = { left: 0, top: 0, right: 1000, bottom: 800 };

    assert.equal(
      getClientAreaCrop(
        frame,
        { left: 0, top: 250, right: 1000, bottom: 800 },
        { width: 1000, height: 800 }
      ),
      null
    );
    assert.equal(
      getClientAreaCrop(
        frame,
        { left: 40, top: 60, right: 1000, bottom: 800 },
        { width: 1000, height: 800 }
      ),
      null
    );
    assert.equal(
      getClientAreaCrop(
        frame,
        { left: 0, top: 60, right: 1000, bottom: 700 },
        { width: 1000, height: 800 }
      ),
      null
    );
  });

  it("limits the title bar trim on small windows", () => {
    const frame = { left: 0, top: 0, right: 320, bottom: 240 };

    assert.equal(
      getClientAreaCrop(
        frame,
        { left: 0, top: 70, right: 320, bottom: 240 },
        { width: 320, height: 240 }
      ),
      null
    );
    assert.deepEqual(
      getClientAreaCrop(
        frame,
        { left: 0, top: 51, right: 320, bottom: 240 },
        { width: 320, height: 240 }
      ),
      { x: 0, y: 51, width: 320, height: 189 }
    );
  });

  it("reads the window handle from a desktop capture source id", () => {
    assert.equal(getWindowHandleFromSourceId("window:132456:0"), "132456");
    assert.equal(getWindowHandleFromSourceId("window:0x2044A:0"), "132170");
    assert.equal(getWindowHandleFromSourceId("screen:0:0"), null);
    assert.equal(getWindowHandleFromSourceId("window:abc:0"), null);
    assert.equal(getWindowHandleFromSourceId("window:0:0"), null);
  });
});
