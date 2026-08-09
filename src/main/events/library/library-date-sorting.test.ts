import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  compareNewUpdates,
  compareReleaseDates,
  parseSortableDate,
} from "../../../shared/library-date-sorting.ts";

describe("library date sorting", () => {
  it("parses ISO, English and Portuguese Steam release dates", () => {
    assert.equal(parseSortableDate("2024-05-20"), Date.UTC(2024, 4, 20));
    assert.equal(parseSortableDate("20 May, 2024"), Date.UTC(2024, 4, 20));
    assert.equal(
      parseSortableDate("20 de maio de 2024"),
      Date.UTC(2024, 4, 20)
    );
    assert.equal(parseSortableDate("Coming soon"), 0);
  });

  it("keeps undated games after dated games", () => {
    const dated = { releaseDateTimestamp: Date.UTC(2024, 4, 20) };
    const undated = { releaseDateTimestamp: null };

    assert.ok(compareReleaseDates(dated, undated) < 0);
    assert.ok(compareReleaseDates(undated, dated) > 0);
  });

  it("orders updates by the most recent upload, then by new options", () => {
    const newer = {
      latestUpdateDate: "2024-05-20T00:00:00.000Z",
      newDownloadOptionsCount: 1,
    };
    const older = {
      latestUpdateDate: "2024-05-19T00:00:00.000Z",
      newDownloadOptionsCount: 10,
    };
    const sameDateMoreOptions = {
      latestUpdateDate: "2024-05-20T00:00:00.000Z",
      newDownloadOptionsCount: 2,
    };

    assert.ok(compareNewUpdates(newer, older) < 0);
    assert.ok(compareNewUpdates(sameDateMoreOptions, newer) < 0);
  });
});
