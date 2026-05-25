import { useEffect } from "react";
import { useNavigationHistoryStore } from "../stores";

export function useHeaderTitle(title: string | null | undefined) {
  const setTopTitle = useNavigationHistoryStore((s) => s.setTopTitle);

  useEffect(() => {
    if (!title) return;
    setTopTitle(title);
  }, [title, setTopTitle]);
}
