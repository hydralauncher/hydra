import { createContext, useCallback, useEffect, useState } from "react";
import type { DownloadSource } from "@types";
import { logger } from "@renderer/logger";

export interface DownloadSourcesContext {
  downloadSources: DownloadSource[];
  isLoading: boolean;
  refreshDownloadSources: () => Promise<void>;
}

export const downloadSourcesContext = createContext<DownloadSourcesContext>({
  downloadSources: [],
  isLoading: true,
  refreshDownloadSources: async () => {},
});

const { Provider } = downloadSourcesContext;
export const { Consumer: DownloadSourcesContextConsumer } =
  downloadSourcesContext;

export interface DownloadSourcesContextProviderProps {
  children: React.ReactNode;
}

export function DownloadSourcesContextProvider({
  children,
}: Readonly<DownloadSourcesContextProviderProps>) {
  const [downloadSources, setDownloadSources] = useState<DownloadSource[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refreshDownloadSources = useCallback(async () => {
    try {
      const sources = await window.electron.getDownloadSources();
      setDownloadSources(sources);
    } catch (error) {
      logger.error("Failed to fetch download sources:", error);
      setDownloadSources([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshDownloadSources();
  }, [refreshDownloadSources]);

  return (
    <Provider
      value={{
        downloadSources,
        isLoading,
        refreshDownloadSources,
      }}
    >
      {children}
    </Provider>
  );
}
