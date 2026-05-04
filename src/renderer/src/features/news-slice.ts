import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import type { NewsArticle } from "@types";

export interface ArticleTranslation {
  title: string;
  contentSnippet: string;
  content?: string;
  detectedLanguage: string | null;
}

export interface NewsState {
  articles: NewsArticle[];
  isLoading: boolean;
  lastFetchedAt: string | null;
  searchQuery: string;
  selectedFeedId: string | null;
  selectedArticle: NewsArticle | null;
  translations: { [articleId: string]: ArticleTranslation };
}

const initialState: NewsState = {
  articles: [],
  isLoading: false,
  lastFetchedAt: null,
  searchQuery: "",
  selectedFeedId: null,
  selectedArticle: null,
  translations: {},
};

export const newsSlice = createSlice({
  name: "news",
  initialState,
  reducers: {
    setArticles: (state, action: PayloadAction<NewsArticle[]>) => {
      state.articles = action.payload;
      state.lastFetchedAt = new Date().toISOString();
    },
    setNewsLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
    setSearchQuery: (state, action: PayloadAction<string>) => {
      state.searchQuery = action.payload;
    },
    setSelectedFeedId: (state, action: PayloadAction<string | null>) => {
      state.selectedFeedId = action.payload;
    },
    setSelectedArticle: (state, action: PayloadAction<NewsArticle | null>) => {
      state.selectedArticle = action.payload;
    },
    setArticleTranslation: (
      state,
      action: PayloadAction<{
        articleId: string;
        translation: ArticleTranslation;
      }>
    ) => {
      state.translations[action.payload.articleId] = action.payload.translation;
    },
    setArticleContentTranslation: (
      state,
      action: PayloadAction<{ articleId: string; content: string }>
    ) => {
      const existing = state.translations[action.payload.articleId];
      if (existing) {
        existing.content = action.payload.content;
      }
    },
    clearNews: (state) => {
      state.articles = [];
      state.lastFetchedAt = null;
      state.searchQuery = "";
      state.selectedFeedId = null;
      state.selectedArticle = null;
      state.translations = {};
    },
  },
});

export const {
  setArticles,
  setNewsLoading,
  setSearchQuery,
  setSelectedFeedId,
  setSelectedArticle,
  setArticleTranslation,
  setArticleContentTranslation,
  clearNews,
} = newsSlice.actions;
