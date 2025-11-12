import { useCallback } from "react";
import { useAppDispatch, useAppSelector } from "./redux";
import { setLibrary } from "@renderer/features";

export function useLibrary() {
  const dispatch = useAppDispatch();
  const library = useAppSelector((state) => state.library.value);

  const updateLibrary = useCallback(async () => {
    return window.electron
      .getLibrary()
      .then((updatedLibrary) => dispatch(setLibrary(updatedLibrary)));
  }, [dispatch]);

  return { library, updateLibrary };
}
