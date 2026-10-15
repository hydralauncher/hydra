declare global {
  interface ImportMetaEnv {
    readonly RENDERER_VITE_EPIC_TIMING?: string;
  }
}

const EPIC_INSTALL_TIMING_MAX_ENTRIES = 32;

export class EpicInstallTiming {
  private readonly options = new Map<
    string,
    { started: number; reported: boolean }
  >();
  constructor(
    readonly enabled: boolean,
    private readonly now = () => performance.now(),
    private readonly emit = (stage: string, duration: number) =>
      console.log(`[epic-timing] renderer.${stage}`, duration)
  ) {}
  beginOptions(objectId: string) {
    if (!this.enabled) return;
    this.options.delete(objectId);
    this.options.set(objectId, { started: this.now(), reported: false });
    while (this.options.size > EPIC_INSTALL_TIMING_MAX_ENTRIES)
      this.options.delete(this.options.keys().next().value!);
  }
  optionsReady(objectId: string, spaceReady = false) {
    const pending = this.options.get(objectId);
    if (!this.enabled || !pending) return;
    if (!pending.reported) {
      pending.reported = true;
      this.write("options-ready", pending.started);
    }
    if (spaceReady) {
      this.options.delete(objectId);
      this.write("options-and-space-ready", pending.started);
    }
  }
  beginSubmit() {
    return this.enabled ? this.now() : undefined;
  }
  accepted(started: number | undefined) {
    if (this.enabled && started !== undefined) this.write("accepted", started);
  }
  private write(stage: string, started: number) {
    try {
      this.emit(stage, Math.max(0, Math.round(this.now() - started)));
    } catch {
      // Diagnostic output must never affect an installation.
    }
  }
}

export const epicInstallTiming = new EpicInstallTiming(
  import.meta.env?.RENDERER_VITE_EPIC_TIMING === "1"
);

export function afterEpicInstallReadyPaint(
  objectId: string,
  timing = epicInstallTiming,
  spaceReady = false
) {
  if (!timing.enabled) return;
  let frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(() => {
      const buttons = document.querySelectorAll<HTMLButtonElement>(
        "button[data-epic-install-submit]"
      );
      if (
        [...buttons].some(
          (button) =>
            button.dataset.epicInstallSubmit === objectId &&
            !button.disabled &&
            button.getAttribute("aria-disabled") !== "true"
        )
      )
        timing.optionsReady(objectId, spaceReady);
    });
  });
  return () => cancelAnimationFrame(frame);
}
