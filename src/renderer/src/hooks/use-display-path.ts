import { useEffect, useState } from "react";

/**
 * Maps a stored access path to the path shown to the user. Under Flatpak,
 * folders picked through the portal are accessed via document-portal paths
 * (/run/user/.../doc/...); this resolves them back to the real host path.
 * Everywhere else it returns the input unchanged.
 */
export function useDisplayPath(accessPath: string | null | undefined) {
  const [displayPath, setDisplayPath] = useState(accessPath ?? "");

  useEffect(() => {
    let cancelled = false;

    if (!accessPath) {
      setDisplayPath("");
      return;
    }

    setDisplayPath(accessPath);

    window.electron
      .getDisplayPath(accessPath)
      .then((resolved) => {
        if (!cancelled) setDisplayPath(resolved);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [accessPath]);

  return displayPath;
}
