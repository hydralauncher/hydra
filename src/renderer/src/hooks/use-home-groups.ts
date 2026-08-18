import { useState, useEffect, useCallback } from "react";
import { useToast } from "./use-toast";

export interface HomeGroup {
  id: string;
  name: string;
  gameIds: string[];
  is_deleted?: boolean;
}

export function useHomeGroups() {
  const [groups, setGroups] = useState<HomeGroup[]>(() => {
    // Carregamento zero-delay: Injetando direto na primeira renderização
    const savedGroups = localStorage.getItem("hydra:home-groups");
    if (savedGroups) {
      try {
        return JSON.parse(savedGroups);
      } catch (e) {
        console.error("Failed to parse home groups", e);
      }
    }
    return [];
  });
  const { showSuccessToast, showErrorToast } = useToast();

  useEffect(() => {
    // Busca assíncrona da nuvem (Stale-While-Revalidate)
    const syncFromCloud = async () => {
      if (typeof window.electron?.fetchHomeGroups !== "function") return;
      const cloudGroups = await window.electron
        .fetchHomeGroups()
        .catch(() => null);
      if (cloudGroups && Array.isArray(cloudGroups)) {
        setGroups(cloudGroups);
        localStorage.setItem("hydra:home-groups", JSON.stringify(cloudGroups));
      }
    };

    syncFromCloud();
  }, []);

  const saveGroups = useCallback(
    (newGroups: HomeGroup[]) => {
      localStorage.setItem("hydra:home-groups", JSON.stringify(newGroups));
      setGroups(newGroups);
      if (typeof window.electron?.syncHomeGroups !== "function") return;
      window.electron
        .syncHomeGroups(newGroups)
        .then((res) => {
          if (res?.status === "synced") {
            showSuccessToast("Pasta sincronizada com o Supabase!");
          }
        })
        .catch((err) => {
          console.error(err);
          showErrorToast("Erro ao sincronizar pasta com Supabase");
        });
    },
    [showSuccessToast, showErrorToast]
  );

  const createGroup = useCallback(
    (name: string, initialGameIds?: string | string[]) => {
      const gIds = Array.isArray(initialGameIds)
        ? initialGameIds
        : initialGameIds
          ? [initialGameIds]
          : [];
      const newGroup: HomeGroup = {
        id: crypto.randomUUID(),
        name,
        gameIds: gIds,
      };
      saveGroups([...groups, newGroup]);
    },
    [groups, saveGroups]
  );

  const renameGroup = useCallback(
    (groupId: string, newName: string) => {
      saveGroups(
        groups.map((g) => {
          if (g.id === groupId) {
            return { ...g, name: newName };
          }
          return g;
        })
      );
    },
    [groups, saveGroups]
  );

  const updateGroup = useCallback(
    (groupId: string, newName: string, newGameIds: string[]) => {
      saveGroups(
        groups.map((g) => {
          if (g.id === groupId) {
            return { ...g, name: newName, gameIds: newGameIds };
          }
          return g;
        })
      );
    },
    [groups, saveGroups]
  );

  const addGameToGroup = useCallback(
    (groupId: string, gameId: string) => {
      saveGroups(
        groups.map((g) => {
          if (g.id === groupId && !g.gameIds.includes(gameId)) {
            return { ...g, gameIds: [...g.gameIds, gameId] };
          }
          // Remove game from other groups if it's already in one?
          // PS5 typically only allows a game in one folder at a time on home screen.
          if (g.id !== groupId && g.gameIds.includes(gameId)) {
            return { ...g, gameIds: g.gameIds.filter((id) => id !== gameId) };
          }
          return g;
        })
      );
    },
    [groups, saveGroups]
  );

  const removeGameFromGroup = useCallback(
    (groupId: string, gameId: string) => {
      saveGroups(
        groups.map((g) => {
          if (g.id === groupId) {
            return { ...g, gameIds: g.gameIds.filter((id) => id !== gameId) };
          }
          return g;
        })
      );
    },
    [groups, saveGroups]
  );

  const removeGamesFromGroup = useCallback(
    (groupId: string, gameIds: string[]) => {
      const toRemove = new Set(gameIds);
      saveGroups(
        groups.map((g) => {
          if (g.id === groupId) {
            return {
              ...g,
              gameIds: g.gameIds.filter((id) => !toRemove.has(id)),
            };
          }
          return g;
        })
      );
    },
    [groups, saveGroups]
  );

  const deleteGroup = useCallback(
    (groupId: string) => {
      saveGroups(
        groups.map((g) => {
          if (g.id === groupId) {
            return { ...g, is_deleted: true };
          }
          return g;
        })
      );
    },
    [groups, saveGroups]
  );

  return {
    groups: groups.filter((g) => !g.is_deleted),
    createGroup,
    addGameToGroup,
    removeGameFromGroup,
    removeGamesFromGroup,
    deleteGroup,
    renameGroup,
    updateGroup,
  };
}
