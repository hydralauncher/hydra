import MigrationWorker from "./migration.worker?worker";
import RepacksWorker from "./repacks.worker?worker";
import DownloadSourcesWorker from "./download-sources.worker?worker";

export const migrationWorker = new MigrationWorker();
export const repacksWorker = new RepacksWorker();
export const downloadSourcesWorker = new DownloadSourcesWorker();
