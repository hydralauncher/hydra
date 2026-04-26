import { useCallback, useEffect, useState } from "react";
import { IS_DESKTOP } from "../constants";
import type { UserDetails } from "@types";

export function useUserDetails() {
  const [userDetails, setUserDetails] = useState<UserDetails | null>(null);

  const fetchUserDetails = useCallback(async () => {
    if (!IS_DESKTOP) return;
    const details = await window.electron.getMe();
    setUserDetails(details);
  }, []);

  useEffect(() => {
    fetchUserDetails();
  }, [fetchUserDetails]);

  return { userDetails, fetchUserDetails };
}
