import { db } from "../level";
import { levelKeys } from "./keys";

export const recompilationInstallsSublevel = db.sublevel<string, string>(
  levelKeys.recompilationInstalls,
  {
    valueEncoding: "json",
  }
);
