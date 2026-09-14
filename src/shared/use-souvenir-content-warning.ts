import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProfileSouvenir } from "@types";

import { getSouvenirKey, shouldShowSouvenirContentWarning } from "./souvenirs";

interface UseSouvenirContentWarningOptions {
  souvenirs: ProfileSouvenir[];
  disableNsfwAlert: boolean;
  ownerUserId?: string;
}

export function useSouvenirContentWarning({
  souvenirs,
  disableNsfwAlert,
  ownerUserId,
}: UseSouvenirContentWarningOptions) {
  const [openSouvenirKey, setOpenSouvenirKey] = useState<string | null>(null);
  const [pendingSouvenirKey, setPendingSouvenirKey] = useState<string | null>(
    null
  );
  const [revealedSouvenirKeys, setRevealedSouvenirKeys] = useState<Set<string>>(
    new Set()
  );

  useEffect(() => {
    setOpenSouvenirKey(null);
    setPendingSouvenirKey(null);
    setRevealedSouvenirKeys(new Set());
  }, [ownerUserId]);

  const openSouvenirIndex = useMemo(
    () =>
      souvenirs.findIndex(
        (souvenir) => getSouvenirKey(souvenir.id) === openSouvenirKey
      ),
    [openSouvenirKey, souvenirs]
  );
  const openSouvenir = souvenirs[openSouvenirIndex] ?? null;
  const pendingSouvenir = useMemo(
    () =>
      souvenirs.find(
        (souvenir) => getSouvenirKey(souvenir.id) === pendingSouvenirKey
      ) ?? null,
    [pendingSouvenirKey, souvenirs]
  );

  const requestOpenSouvenir = useCallback(
    (souvenir: ProfileSouvenir) => {
      const key = getSouvenirKey(souvenir.id);

      if (
        !revealedSouvenirKeys.has(key) &&
        shouldShowSouvenirContentWarning(souvenir, disableNsfwAlert)
      ) {
        setPendingSouvenirKey(key);
        return false;
      }

      setOpenSouvenirKey(key);
      return true;
    },
    [disableNsfwAlert, revealedSouvenirKeys]
  );

  const confirmContentWarning = useCallback(() => {
    if (!pendingSouvenirKey) return;

    setRevealedSouvenirKeys((current) =>
      new Set(current).add(pendingSouvenirKey)
    );
    setOpenSouvenirKey(pendingSouvenirKey);
    setPendingSouvenirKey(null);
  }, [pendingSouvenirKey]);

  const dismissContentWarning = useCallback(() => {
    setPendingSouvenirKey(null);
  }, []);

  const closeSouvenir = useCallback(() => {
    setOpenSouvenirKey(null);
    setPendingSouvenirKey(null);
    setRevealedSouvenirKeys(new Set());
  }, []);

  return {
    openSouvenirKey,
    openSouvenirIndex,
    openSouvenir,
    pendingSouvenir,
    requestOpenSouvenir,
    confirmContentWarning,
    dismissContentWarning,
    closeSouvenir,
  };
}
