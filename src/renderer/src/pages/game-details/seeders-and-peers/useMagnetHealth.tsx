import { useEffect, useState } from "react";
import { TorrentData } from "./types";

const cache: Record<string, TorrentData> = {};

export function useMagnetHealth(magnet: string) {
  const [magnetData, setMagnetData] = useState<TorrentData | null>(
    cache[magnet] || null
  );
  const [isLoading, setIsLoading] = useState(() => {
    if (cache[magnet]) {
      return false;
    }

    return true;
  });
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!magnet) {
      return;
    }

    if (cache[magnet]) {
      setMagnetData(cache[magnet]);
      setIsLoading(false);
      return;
    }

    window.electron.getMagnetHealth(magnet).then(
      (result) => {
        if (result) {
          setMagnetData(result);
          setIsLoading(false);

          cache[magnet] = result;
          cache[magnet].lastTracked = new Date();
        }
      },
      (error) => {
        setError(error);
        setIsLoading(false);
      }
    );
  }, [magnet]);


  useEffect(() => {
    function invalidateCache() {
      const TWO_MINUTES = 2 * 60 * 1000;
      const cacheExpiresIn = TWO_MINUTES;

      Object.keys(cache).forEach((key) => {
        const lastTracked = cache[key].lastTracked;

        if (!lastTracked) {
          return;
        }

        if (Date.now() - lastTracked.getTime() > cacheExpiresIn) {
          delete cache[key];
        }
      });
    }

    invalidateCache();

    return () => {
      invalidateCache();
    };
  }, []);

  return {
    magnetData,
    isLoading,
    error,
  };
}
