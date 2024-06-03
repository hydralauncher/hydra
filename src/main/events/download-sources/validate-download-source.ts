import { registerEvent } from "../register-event";
import axios from "axios";
import { downloadSourceRepository } from "@main/repository";
import { downloadSourceSchema } from "../helpers/validators";
import { RepacksManager } from "@main/services";

const validateDownloadSource = async (
  _event: Electron.IpcMainInvokeEvent,
  url: string
) => {
  const response = await axios.get(url);

  const source = downloadSourceSchema.parse(response.data);

  const existingSource = await downloadSourceRepository.findOne({
    where: { url },
  });

  if (existingSource)
    throw new Error("Source with the same url already exists");

  const repacks = RepacksManager.repacks;

  const existingUris = source.downloads
    .flatMap((download) => download.uris)
    .filter((uri) => repacks.some((repack) => repack.magnet === uri));

  return {
    name: source.name,
    downloadCount: source.downloads.length - existingUris.length,
  };
};

registerEvent("validateDownloadSource", validateDownloadSource);
