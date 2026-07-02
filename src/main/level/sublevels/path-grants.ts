import type { PathGrant } from "@types";

import { db } from "../level";
import { levelKeys } from "./keys";

export const pathGrantsSublevel = db.sublevel<string, PathGrant>(
  levelKeys.pathGrants,
  {
    valueEncoding: "json",
  }
);
