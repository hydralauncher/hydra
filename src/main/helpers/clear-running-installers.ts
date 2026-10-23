import { downloadsSublevel } from "@main/level";

export const clearRunningInstallers = async () => {
  const entries = await downloadsSublevel.iterator().all();

  await Promise.all(
    entries
      .filter(([, download]) => download.installerRunning)
      .map(([key, download]) =>
        downloadsSublevel.put(key, { ...download, installerRunning: false })
      )
  );
};
