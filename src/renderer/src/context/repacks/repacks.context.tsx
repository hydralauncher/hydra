import type { GameRepack } from "@types";
import { createContext, useCallback, useEffect, useState } from "react";

import { repacksWorker } from "@renderer/workers";

export interface RepacksContext {
  searchRepacks: (query: string) => Promise<GameRepack[]>;
  isIndexingRepacks: boolean;
}

export const repacksContext = createContext<RepacksContext>({
  searchRepacks: async () => [] as GameRepack[],
  isIndexingRepacks: false,
});

const { Provider } = repacksContext;
export const { Consumer: RepacksContextConsumer } = repacksContext;

export interface RepacksContextProps {
  children: React.ReactNode;
}

export function RepacksContextProvider({ children }: RepacksContextProps) {
  const [isIndexingRepacks, setIsIndexingRepacks] = useState(true);

  const searchRepacks = useCallback(async (query: string) => {
    return new Promise<GameRepack[]>((resolve) => {
      const channelId = crypto.randomUUID();
      repacksWorker.postMessage([channelId, query]);

      const channel = new BroadcastChannel(`repacks:search:${channelId}`);
      channel.onmessage = (event: MessageEvent<GameRepack[]>) => {
        resolve(event.data);
      };

      return [];
    });
  }, []);

  useEffect(() => {
    repacksWorker.postMessage("INDEX_REPACKS");

    repacksWorker.onmessage = () => {
      setIsIndexingRepacks(false);
    };
  }, []);

  return (
    <Provider
      value={{
        searchRepacks,
        isIndexingRepacks,
      }}
    >
      {children}
    </Provider>
  );
}
