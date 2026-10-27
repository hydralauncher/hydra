import type { Game } from "@types";

import { db } from "../level";
import { gamesSublevel } from "./games";

const gamesPrefix = gamesSublevel.prefix;

let snapshot: Promise<Game[]> | null = null;
let version = 0;

const invalidate = () => {
  version++;
  snapshot = null;
};

const keyToString = (key: unknown) => {
  if (typeof key === "string") return key;
  if (key instanceof Uint8Array) return Buffer.from(key).toString();
  return String(key);
};

db.on("write", (operations) => {
  if (
    operations.some((operation) =>
      keyToString(operation.key).startsWith(gamesPrefix)
    )
  ) {
    invalidate();
  }
});
db.on("clear", invalidate);
gamesSublevel.on("write", invalidate);
gamesSublevel.on("clear", invalidate);

export const getGamesSnapshot = (): Promise<Game[]> => {
  if (snapshot !== null) return snapshot;

  const readVersion = version;
  const read = gamesSublevel.values().all();
  snapshot = read;

  read.then(
    () => {
      if (readVersion !== version && snapshot === read) snapshot = null;
    },
    () => {
      if (snapshot === read) snapshot = null;
    }
  );

  return read;
};
