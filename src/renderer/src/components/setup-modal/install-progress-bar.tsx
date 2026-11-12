export interface InstallProgressLike {
  phase: string;
  loaded?: number;
  total?: number;
}

export const installPercent = (loaded?: number, total?: number): number =>
  total && total > 0 ? Math.floor(((loaded ?? 0) / total) * 100) : 0;

export function InstallProgressBar({
  progress,
}: Readonly<{ progress: InstallProgressLike | undefined }>) {
  if (!progress) return null;
  if (progress.phase === "done" || progress.phase === "error") return null;

  const hasTotal = Boolean(progress.total && progress.total > 0);
  const indeterminate = progress.phase !== "downloading" || !hasTotal;
  const percent = hasTotal
    ? Math.min(100, installPercent(progress.loaded, progress.total))
    : 0;

  return (
    <div className="setup-modal__progress-bar" style={{ marginTop: 10 }}>
      <div
        className={`setup-modal__progress-fill ${
          indeterminate ? "setup-modal__progress-fill--indeterminate" : ""
        }`}
        style={indeterminate ? undefined : { width: `${percent}%` }}
      />
    </div>
  );
}
