import { useCallback } from 'react';
import { useAppDispatch, useAppSelector } from './use-store';
import {
    addCollection,
    updateCollection,
    deleteCollection,
    addGameToCollection,
    removeGameFromCollection
} from '@renderer/features';
import type { GameCollection } from '@renderer/features/collections-slice';

export function useCollections() {
    const dispatch = useAppDispatch();
    const collections = useAppSelector(state => state.collections.collections);

    const createCollection = useCallback((name: string, description?: string) => {
        const newCollection: GameCollection = {
            id: crypto.randomUUID(),
            name,
            description,
            gameIds: [],
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        dispatch(addCollection(newCollection));
        return newCollection.id;
    }, [dispatch]);

    const addToCollection = useCallback((collectionId: string, gameId: string) => {
        dispatch(addGameToCollection({ collectionId, gameId }));
    }, [dispatch]);

    const removeFromCollection = useCallback((collectionId: string, gameId: string) => {
        dispatch(removeGameFromCollection({ collectionId, gameId }));
    }, [dispatch]);

    const isGameInCollection = useCallback((collectionId: string, gameId: string) => {
        const collection = collections.find(c => c.id === collectionId);
        return collection ? collection.gameIds.includes(gameId) : false;
    }, [collections]);

    const getCollectionsWithGame = useCallback((gameId: string) => {
        return collections.filter(collection => collection.gameIds.includes(gameId));
    }, [collections]);

    const getCollectionsWithoutGame = useCallback((gameId: string) => {
        return collections.filter(collection => !collection.gameIds.includes(gameId));
    }, [collections]);

    return {
        collections,
        createCollection,
        addToCollection,
        removeFromCollection,
        isGameInCollection,
        getCollectionsWithGame,
        getCollectionsWithoutGame
    };
} 