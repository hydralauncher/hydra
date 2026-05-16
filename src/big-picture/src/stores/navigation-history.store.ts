import { create } from "zustand";

export interface NavigationHistoryEntry {
  key: string;
  pathname: string;
  title: string;
}

interface NavigationHistoryState {
  stack: NavigationHistoryEntry[];
  push: (entry: NavigationHistoryEntry) => void;
  pop: () => void;
  replaceTop: (entry: NavigationHistoryEntry) => void;
  setTopTitle: (title: string) => void;
}

export const useNavigationHistoryStore = create<NavigationHistoryState>(
  (set) => ({
    stack: [],
    push: (entry) =>
      set((state) => {
        const last = state.stack[state.stack.length - 1];
        if (last && last.key === entry.key) return state;
        return { stack: [...state.stack, entry] };
      }),
    pop: () =>
      set((state) =>
        state.stack.length === 0 ? state : { stack: state.stack.slice(0, -1) }
      ),
    replaceTop: (entry) =>
      set((state) => {
        if (state.stack.length === 0) return { stack: [entry] };
        const stack = state.stack.slice(0, -1);
        stack.push(entry);
        return { stack };
      }),
    setTopTitle: (title) =>
      set((state) => {
        if (state.stack.length === 0) return state;
        const stack = [...state.stack];
        const top = stack[stack.length - 1];
        if (top.title === title) return state;
        stack[stack.length - 1] = { ...top, title };
        return { stack };
      }),
  })
);
