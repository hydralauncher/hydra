import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { restoreIniValue } from "./duckstation-souvenir-config-value.js";

describe("DuckStation souvenir configuration", () => {
  it("restores a logging value that was disabled before souvenirs", () => {
    const enabled = "[Logging]\nLogToFile = true\nLogLevel = Info";

    assert.equal(
      restoreIniValue(enabled, "Logging", "LogToFile", "LogToFile = false"),
      "[Logging]\nLogToFile = false\nLogLevel = Info"
    );
  });

  it("removes the logging value when Hydra originally added it", () => {
    const enabled = "[Logging]\nLogToFile = true\nLogLevel = Info";

    assert.equal(
      restoreIniValue(enabled, "Logging", "LogToFile", null),
      "[Logging]\nLogLevel = Info"
    );
  });
});
