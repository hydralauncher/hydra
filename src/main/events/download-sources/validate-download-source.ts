import { registerEvent } from "../register-event";
import axios from "axios";
import { z } from "zod";

const downloadSourceSchema = z.object({
  name: z.string().max(255),
  downloads: z.array(
    z.object({
      title: z.string().max(255),
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
  const response = await axios.get<z.infer<typeof downloadSourceSchema>>(url);

  const { name } = downloadSourceSchema.parse(response.data);

  return {
    name,
    etag: response.headers["etag"] || null,
    downloadCount: response.data.downloads.length,
  };
};

registerEvent("validateDownloadSource", validateDownloadSource);
