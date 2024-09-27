import RepacksWorker from "./repacks.worker?worker";
import DownloadSourcesWorker from "./download-sources.worker?worker";

export const repacksWorker = new RepacksWorker();
export const downloadSourcesWorker = new DownloadSourcesWorker();
