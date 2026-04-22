import { useMemo, useState, useEffect } from "react";
import debounce from "lodash-es/debounce";

export function useSearch<T>(items: T[], fieldsToSearch: (keyof T)[]) {
  const [search, setSearch] = useState("");

  const debouncedSetSearch = useMemo(
    () => debounce((value: string) => setSearch(value), 100),
    []
  );

  useEffect(() => {
    debouncedSetSearch(search);
    return () => debouncedSetSearch.cancel();
  }, [search, debouncedSetSearch]);

  const indexedItems = useMemo(() => {
    return items.map((item) => {
      const searchText = fieldsToSearch
        .map((field) => {
          const value = item[field];
          return typeof value === "string" ? value.toLowerCase() : "";
        })
        .join(" ");
      return { item, searchText };
    });
  }, [items, fieldsToSearch]);

  const filteredItems = useMemo(() => {
    if (!search) return items;

    const searchLower = search.toLowerCase();
    const result: T[] = [];

    for (let i = 0; i < indexedItems.length; i++) {
      const { item, searchText } = indexedItems[i];
      if (searchText.includes(searchLower)) {
        result.push(item);
      }
    }

    return result;
  }, [indexedItems, search, items]);

  return {
    search,
    setSearch,
    filteredItems,
  };
}
