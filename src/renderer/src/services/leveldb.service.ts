class LevelDBService {
  get(
    key: string,
    sublevelName?: string | null,
    valueEncoding?: "json" | "utf8"
  ): Promise<unknown> {
    return window.electron.leveldb.get(key, sublevelName, valueEncoding);
  }

  put(
    key: string,
    value: unknown,
    sublevelName?: string | null,
    valueEncoding?: "json" | "utf8"
  ): Promise<void> {
    return window.electron.leveldb.put(key, value, sublevelName, valueEncoding);
  }

  del(key: string, sublevelName?: string | null): Promise<void> {
    return window.electron.leveldb.del(key, sublevelName);
  }

  clear(sublevelName: string): Promise<void> {
    return window.electron.leveldb.clear(sublevelName);
  }

  values(sublevelName: string): Promise<unknown[]> {
    return window.electron.leveldb.values(sublevelName);
  }

  iterator(sublevelName: string): Promise<[string, unknown][]> {
    return window.electron.leveldb.iterator(sublevelName);
  }
}

export const levelDBService = new LevelDBService();
