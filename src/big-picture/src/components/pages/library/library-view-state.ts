export interface LibraryViewState {
  scrollTop: number;
  focusedItemId: string | null;
  search: string;
}

let libraryViewState: LibraryViewState | null = null;

export function getLibraryViewState() {
  return libraryViewState;
}

export function hasLibraryViewState() {
  return libraryViewState !== null;
}

export function saveLibraryScrollPosition(scrollTop: number) {
  libraryViewState = {
    scrollTop,
    focusedItemId: libraryViewState?.focusedItemId ?? null,
    search: libraryViewState?.search ?? "",
  };
}

export function saveLibraryFocusedItemId(focusedItemId: string) {
  libraryViewState = {
    scrollTop: libraryViewState?.scrollTop ?? 0,
    focusedItemId,
    search: libraryViewState?.search ?? "",
  };
}

export function saveLibrarySearch(search: string) {
  libraryViewState = {
    scrollTop: libraryViewState?.scrollTop ?? 0,
    focusedItemId: libraryViewState?.focusedItemId ?? null,
    search,
  };
}
