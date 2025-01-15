import { levelDatabasePath } from "@main/constants";
import { Level } from "level";

export const db = new Level(levelDatabasePath, { valueEncoding: "json" });
