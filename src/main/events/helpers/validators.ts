import { z } from "zod";

export const downloadSourceSchema = z.object({
  name: z.string().max(255),
  downloads: z.array(
    z.object({
      title: z.string().max(255),
      objectId: z.string().max(255).nullable(),
      shop: z.enum(["steam"]).nullable(),
      downloaders: z.array(z.enum(["real_debrid", "torrent"])),
      uris: z.array(z.string()),
      uploadDate: z.string().max(255),
      fileSize: z.string().max(255),
    })
  ),
});
