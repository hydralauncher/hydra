import { z } from "zod";

export const downloadSourceSchema = z.object({
  name: z.string().max(255),
  downloads: z.array(
    z.object({
      title: z.string().max(255),
      downloaders: z.array(z.enum(["real_debrid", "torrent"])),
      uris: z.array(z.string()),
      uploadDate: z.string().max(255),
      fileSize: z.string().max(255),
    })
  ),
});

const gamesArray = z.array(
  z.object({
    id: z.number(),
    objectId: z.string().max(255),
    playTimeInMilliseconds: z.number().int(),
    shop: z.enum(["steam", "epic"]),
    lastTimePlayed: z.coerce.date().nullable(),
  })
);

export const userProfileSchema = z.object({
  username: z.string(),
  game: gamesArray,
  recentGames: gamesArray,
});
