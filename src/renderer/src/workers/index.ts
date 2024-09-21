import MigrationWorker from "./migration.worker?worker";
import RepacksWorker from "./repacks.worker?worker";
import DownloadSourcesWorker from "./download-sources.worker?worker";

// const migrationWorker = new MigrationWorker();
export const repacksWorker = new RepacksWorker();
export const downloadSourcesWorker = new DownloadSourcesWorker();

// window.electron.getRepacks().then((repacks) => {
//   console.log(repacks);
//   migrationWorker.postMessage(["MIGRATE_REPACKS", repacks]);
// });

// window.electron.getDownloadSources().then((downloadSources) => {
//   migrationWorker.postMessage(["MIGRATE_DOWNLOAD_SOURCES", downloadSources]);
// });

// migrationWorker.onmessage = (event) => {
//   console.log(event.data);
// };

// setTimeout(() => {
//   repacksWorker.postMessage("god");
// }, 500);
