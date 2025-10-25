import { registerEvent } from "../register-event";
import axios from "axios";
import * as yup from "yup";

const downloadSourceSchema = yup.object({
  name: yup.string().max(255).required(),
  downloads: yup
    .array(
      yup.object({
        title: yup.string().max(255).required(),
        uris: yup.array(yup.string().required()).required(),
        uploadDate: yup.string().max(255).required(),
        fileSize: yup.string().max(255).required(),
      })
    )
    .required(),
});

const validateDownloadSource = async (
  _event: Electron.IpcMainInvokeEvent,
  url: string
) => {
  const response = await axios.get(url);

  const validatedData = await downloadSourceSchema.validate(response.data);
  const { name } = validatedData;

  return {
    name,
    etag: response.headers["etag"] || null,
    downloadCount: response.data.downloads.length,
  };
};

registerEvent("validateDownloadSource", validateDownloadSource);
