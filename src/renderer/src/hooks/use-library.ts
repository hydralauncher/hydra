import { useCallback } from "react";
import { useAppDispatch, useAppSelector } from "./redux";
import { setLibrary } from "@renderer/features";

export function useLibrary() {
  const dispatch = useAppDispatch();
  const library = useAppSelector((state) => state.library.value);
  const downloadLibrary = useAppSelector(
    (state) => state.library.downloadLibrary
  );

  const updateLibrary = useCallback(async () => {
    return window.electron
      .getLibrary(true)
      .then((updatedLibrary) => dispatch(setLibrary(updatedLibrary)));
  }, [dispatch]);

  return { library, downloadLibrary, updateLibrary };
}
