import { db } from "../level";
import { levelKeys } from "./keys";

export interface GameRepack {
  id: number;
  title: string;
  uris: string[];
  repacker: string;
  fileSize: string | null;
  objectIds: string[];
  uploadDate: Date | string | null;
  downloadSourceId: number;
  createdAt: Date;
  updatedAt: Date;
}

export const repacksSublevel = db.sublevel<string, GameRepack>(
  levelKeys.repacks,
  {
    valueEncoding: "json",
  }
);
