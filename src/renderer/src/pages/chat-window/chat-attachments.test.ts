import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CHAT_MESSAGE_ATTACHMENTS_MAX_BYTES,
  fitWithin,
  fitsMessageBudget,
  getChatImageLayout,
  getUploadProgress,
  selectImageFiles,
} from "./chat-attachments.js";

const file = (type: string) => ({ type });

describe("selectImageFiles", () => {
  it("keeps images and says when other files were left out", () => {
    const result = selectImageFiles(
      [file("image/png"), file("text/plain"), file("image/gif")],
      0
    );

    assert.deepEqual(result.files, [file("image/png"), file("image/gif")]);
    assert.equal(result.error, "unsupported");
  });

  it("stops at four images per message, counting the ones held", () => {
    const result = selectImageFiles(
      [file("image/png"), file("image/jpeg"), file("image/webp")],
      2
    );

    assert.equal(result.files.length, 2);
    assert.equal(result.error, "too_many");
  });

  it("takes nothing once the composer is full", () => {
    assert.deepEqual(selectImageFiles([file("image/png")], 4), {
      files: [],
      error: "too_many",
    });
  });

  it("reports nothing when every file fits", () => {
    assert.equal(selectImageFiles([file("image/png")], 0).error, null);
  });
});

describe("fitsMessageBudget", () => {
  const held = (size: number) => ({ blob: { size } as Blob });

  it("allows images up to the message total", () => {
    assert.equal(
      fitsMessageBudget([held(CHAT_MESSAGE_ATTACHMENTS_MAX_BYTES - 10)], 10),
      true
    );
    assert.equal(
      fitsMessageBudget([held(CHAT_MESSAGE_ATTACHMENTS_MAX_BYTES - 10)], 11),
      false
    );
  });
});

describe("fitWithin", () => {
  it("scales the longest side down and keeps the shape", () => {
    assert.deepEqual(fitWithin(4032, 3024, 1568), {
      width: 1568,
      height: 1176,
    });
    assert.deepEqual(fitWithin(1080, 1920, 1568), { width: 882, height: 1568 });
  });

  it("never scales up", () => {
    assert.deepEqual(fitWithin(300, 200, 1568), { width: 300, height: 200 });
  });
});

describe("getChatImageLayout", () => {
  it("keeps a single image's shape within 280 px", () => {
    assert.deepEqual(getChatImageLayout([{ width: 1920, height: 1080 }]), {
      width: 280,
      columns: 1,
      cells: [{ height: 158, isWide: false }],
    });
    assert.deepEqual(getChatImageLayout([{ width: 1080, height: 1920 }]), {
      width: 158,
      columns: 1,
      cells: [{ height: 280, isWide: false }],
    });
  });

  it("gives tiny and extreme images a minimum size", () => {
    assert.deepEqual(getChatImageLayout([{ width: 40, height: 40 }]), {
      width: 96,
      columns: 1,
      cells: [{ height: 64, isWide: false }],
    });
    assert.deepEqual(getChatImageLayout([{ width: 2000, height: 50 }]), {
      width: 280,
      columns: 1,
      cells: [{ height: 64, isWide: false }],
    });
  });

  it("assumes a wide image while the size is unknown", () => {
    assert.equal(
      getChatImageLayout([{ width: null, height: null }]).cells[0].height,
      158
    );
  });

  it("puts two to four images in a fixed-width grid", () => {
    const size = { width: 100, height: 100 };

    assert.deepEqual(getChatImageLayout([size, size]), {
      width: 280,
      columns: 2,
      cells: [
        { height: 160, isWide: false },
        { height: 160, isWide: false },
      ],
    });
    assert.deepEqual(getChatImageLayout([size, size, size]).cells, [
      { height: 156, isWide: true },
      { height: 104, isWide: false },
      { height: 104, isWide: false },
    ]);
    assert.deepEqual(
      getChatImageLayout([size, size, size, size]).cells.map(
        (cell) => cell.height
      ),
      [120, 120, 120, 120]
    );
  });
});

describe("getUploadProgress", () => {
  it("weighs each image by its size", () => {
    assert.equal(getUploadProgress([100, 0], [100, 300]), 0.25);
    assert.equal(getUploadProgress([100, 300], [100, 300]), 1);
  });

  it("caps bytes past an image's size", () => {
    assert.equal(getUploadProgress([150], [100]), 1);
  });

  it("is zero with nothing to send", () => {
    assert.equal(getUploadProgress([], []), 0);
  });
});
