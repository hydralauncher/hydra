import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";

export interface GameCollection {
    id: string;
    name: string;
    description?: string;
    coverImageUrl?: string;
    gameIds: string[];
    createdAt: number;
    updatedAt: number;
}

export interface CollectionsState {
    collections: GameCollection[];
    activeCollectionId: string | null;
}

const initialState: CollectionsState = {
    collections: [],
    activeCollectionId: null,
};

export const collectionsSlice = createSlice({
    name: "collections",
    initialState,
    reducers: {
        setCollections: (state, action: PayloadAction<GameCollection[]>) => {
            state.collections = action.payload;
        },
        addCollection: (state, action: PayloadAction<GameCollection>) => {
            state.collections.push(action.payload);
        },
        updateCollection: (state, action: PayloadAction<GameCollection>) => {
            const index = state.collections.findIndex(c => c.id === action.payload.id);
            if (index !== -1) {
                state.collections[index] = action.payload;
            }
        },
        deleteCollection: (state, action: PayloadAction<string>) => {
            state.collections = state.collections.filter(c => c.id !== action.payload);
            if (state.activeCollectionId === action.payload) {
                state.activeCollectionId = null;
            }
        },
        addGameToCollection: (state, action: PayloadAction<{ collectionId: string; gameId: string }>) => {
            const { collectionId, gameId } = action.payload;
            const collection = state.collections.find(c => c.id === collectionId);
            if (collection && !collection.gameIds.includes(gameId)) {
                collection.gameIds.push(gameId);
                collection.updatedAt = Date.now();
            }
        },
        removeGameFromCollection: (state, action: PayloadAction<{ collectionId: string; gameId: string }>) => {
            const { collectionId, gameId } = action.payload;
            const collection = state.collections.find(c => c.id === collectionId);
            if (collection) {
                collection.gameIds = collection.gameIds.filter(id => id !== gameId);
                collection.updatedAt = Date.now();
            }
        },
        setActiveCollection: (state, action: PayloadAction<string | null>) => {
            state.activeCollectionId = action.payload;
        },
    },
});

export const {
    setCollections,
    addCollection,
    updateCollection,
    deleteCollection,
    addGameToCollection,
    removeGameFromCollection,
    setActiveCollection,
} = collectionsSlice.actions; 