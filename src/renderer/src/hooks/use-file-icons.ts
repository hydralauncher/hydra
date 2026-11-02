import { useEffect, useState } from "react";

export function useFileIcons(filePaths: string[]) {
  const [icons, setIcons] = useState<Record<string, string | null>>({});
  const pathsKey = filePaths.join("\n");

  useEffect(() => {
    const paths = pathsKey ? pathsKey.split("\n") : [];
    if (paths.length === 0) return undefined;

    let cancelled = false;

    void Promise.all(
      paths.map(async (filePath) => {
        const icon = await globalThis.window.electron
          .getFileIcon(filePath)
          .catch(() => null);
        return [filePath, icon] as const;
      })
    ).then((entries) => {
      if (cancelled) return;
      setIcons((current) => ({ ...current, ...Object.fromEntries(entries) }));
    });

    return () => {
      cancelled = true;
    };
  }, [pathsKey]);

  return icons;
}
