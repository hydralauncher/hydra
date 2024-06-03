import { z } from "zod";
import { registerEvent } from "../register-event";
import axios from "axios";
import { downloadSourceRepository } from "@main/repository";

const downloadSourceSchema = z.object({
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

const validateDownloadSource = async (
  _event: Electron.IpcMainInvokeEvent,
  url: string
) => {
  const response = await axios.get(url);

  const source = downloadSourceSchema.parse(response.data);

  const existingSource = await downloadSourceRepository.findOne({
    where: [{ url }, { name: source.name }],
  });

  if (existingSource?.url === url)
    throw new Error("Source with the same url already exists");

  return { name: source.name, downloadCount: source.downloads.length };
};

registerEvent("validateDownloadSource", validateDownloadSource);
