import { useEffect, useState } from "react";

export function usePs4FolderVersions(discPaths: string[], enabled = true) {
  const [versions, setVersions] = useState<Record<string, string | null>>({});
  const [refreshKey, setRefreshKey] = useState(0);
  const pathsKey = discPaths.join("|");

  useEffect(() => {
    if (!enabled) return;
    return window.electron.onPs4PkgJob((event) => {
      if (event.phase === "done") setRefreshKey((key) => key + 1);
    });
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !pathsKey) {
      setVersions({});
      return;
    }
    let active = true;
    void window.electron
      .getPs4FolderVersions(pathsKey.split("|"))
      .then((result) => {
        if (active) setVersions(result);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [enabled, pathsKey, refreshKey]);

  return versions;
}
