import { useCallback, useEffect, useState } from "react";
import { useAppDispatch, useAppSelector } from "./redux";
import { setUserAuth } from "@renderer/features";

export function useUserAuth() {
  const dispatch = useAppDispatch();

  const [isLoading, setIsLoading] = useState(false);

  const { userAuth } = useAppSelector((state) => state.userAuth);

  const signOut = useCallback(async () => {
    dispatch(setUserAuth(null));
    return window.electron.signout();
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
