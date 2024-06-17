import { useCallback, useEffect, useState } from "react";
import { useAppDispatch, useAppSelector } from "./redux";
import { setUserAuth } from "@renderer/features";

export function useUserAuth() {
  const dispatch = useAppDispatch();

  const [isLoading, setIsLoading] = useState(true);

  const { userAuth } = useAppSelector((state) => state.userAuth);

  const signOut = useCallback(async () => {
    dispatch(setUserAuth(null));
    return window.electron.signOut();
  }, [dispatch]);

  const updateUserAuth = useCallback(async () => {
    setIsLoading(true);

    return window.electron
      .getMe()
      .then((userAuth) => dispatch(setUserAuth(userAuth)))
      .finally(() => {
        setIsLoading(false);
      });
  }, [dispatch]);

  useEffect(() => {
    updateUserAuth();
  }, []);

  const clearUserAuth = useCallback(async () => {
    dispatch(setUserAuth(null));
  }, [dispatch]);

  return { userAuth, isLoading, updateUserAuth, signOut, clearUserAuth };
}
