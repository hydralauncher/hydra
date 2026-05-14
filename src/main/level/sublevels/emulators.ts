import { db } from "../level";
import { levelKeys } from "./keys";
import type { EmulatorConfig, EmulatorSystem } from "@types";

export const emulatorsSublevel = db.sublevel<EmulatorSystem, EmulatorConfig>(
  levelKeys.emulators,
  {
    valueEncoding: "json",
  }
);
