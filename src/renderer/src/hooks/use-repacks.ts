import { repacksTable } from "@renderer/dexie";
import { setRepacks } from "@renderer/features";
import { useCallback } from "react";
import { RootState } from "@renderer/store";
import { useSelector } from "react-redux";
import { useAppDispatch } from "./redux";

export function useRepacks() {
  const dispatch = useAppDispatch();
  const repacks = useSelector((state: RootState) => state.repacks.value);

  const getRepacksForObjectId = useCallback(
    (objectId: string) => {
      return repacks.filter((repack) => repack.objectIds.includes(objectId));
    },
    [repacks]
  );

  const updateRepacks = useCallback(() => {
    repacksTable.toArray().then((repacks) => {
      dispatch(
        setRepacks(repacks.filter((repack) => Array.isArray(repack.objectIds)))
      );
    });
  }, [dispatch]);

  return { getRepacksForObjectId, updateRepacks };
}
