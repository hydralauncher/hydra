import type { LocalScreenshot } from "@types";

import { db } from "../level";
import { levelKeys } from "./keys";

export const screenshotsSublevel = db.sublevel<string, LocalScreenshot>(
  levelKeys.screenshots,
  { valueEncoding: "json" }
);
