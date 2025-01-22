import { levelDatabasePath } from "@main/constants";
import { ClassicLevel } from "classic-level";

export const db = new ClassicLevel(levelDatabasePath, {
  valueEncoding: "json",
});
