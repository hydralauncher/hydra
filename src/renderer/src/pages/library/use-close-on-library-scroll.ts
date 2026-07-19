import { useEffect, useState } from "react";

export function useCloseOnLibraryScroll() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    const scrollElement = document.querySelector(".library__games-scroll");
    if (!scrollElement) return;

    const close = () => setOpen(false);
    scrollElement.addEventListener("wheel", close, { passive: true });
    scrollElement.addEventListener("scroll", close, { passive: true });

    return () => {
      scrollElement.removeEventListener("wheel", close);
      scrollElement.removeEventListener("scroll", close);
    };
  }, [open]);

  return [open, setOpen] as const;
}
