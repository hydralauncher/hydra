import { useLayoutEffect, useRef } from "react";

export class GalleryVideoHost {
  readonly container: HTMLDivElement;
  private home: HTMLElement | null = null;
  private borrowers: HTMLElement[] = [];

  constructor() {
    this.container = document.createElement("div");
    this.container.className = "gallery-video-host";
  }

  setHome(element: HTMLElement) {
    this.home = element;
    this.place();
  }

  clearHome(element: HTMLElement) {
    if (this.home === element) this.home = null;
  }

  borrow(element: HTMLElement) {
    this.borrowers = [
      ...this.borrowers.filter((borrower) => borrower !== element),
      element,
    ];
    this.place();
  }

  release(element: HTMLElement) {
    this.borrowers = this.borrowers.filter((borrower) => borrower !== element);
    this.place();
  }

  private place() {
    const target = this.borrowers.at(-1) ?? this.home;
    if (target && this.container.parentElement !== target) {
      target.appendChild(this.container);
    }
  }
}

interface GalleryVideoSlotProps {
  host: GalleryVideoHost;
  mode: "home" | "borrow";
}

export function GalleryVideoSlot({
  host,
  mode,
}: Readonly<GalleryVideoSlotProps>) {
  const slotRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const slot = slotRef.current;
    if (!slot) return undefined;

    if (mode === "home") {
      host.setHome(slot);
      return () => host.clearHome(slot);
    }

    host.borrow(slot);
    return () => host.release(slot);
  }, [host, mode]);

  return <div ref={slotRef} className={`gallery-video-slot--${mode}`} />;
}
