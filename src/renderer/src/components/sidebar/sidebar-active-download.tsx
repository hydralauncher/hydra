import { useDownload, useLibrary } from "@renderer/hooks";
import { useNavigate } from "react-router-dom";
import { buildGameDetailsPath } from "@renderer/helpers";
import { DownloadIcon } from "@primer/octicons-react";

export function SidebarActiveDownload() {
  const { lastPacket, progress } = useDownload();
  const { library } = useLibrary();
  const navigate = useNavigate();

  if (!lastPacket) return null;

  const [shop, objectId] = lastPacket.gameId.split(":");
  const game = library.find((g) => g.objectId === objectId && g.shop === shop);

  const title = game?.title ?? lastPacket.gameId;
  const pct = Math.round((lastPacket.progress ?? 0) * 100);

  const handleClick = () => {
    if (game) {
      navigate(
        buildGameDetailsPath({
          objectId: game.objectId,
          shop: game.shop,
          title: game.title,
        })
      );
    }
  };

  return (
    <button
      type="button"
      className="sidebar-active-download"
      onClick={handleClick}
    >
      <div className="sidebar-active-download__header">
        <DownloadIcon size={12} />
        <span className="sidebar-active-download__title">{title}</span>
        <span className="sidebar-active-download__pct">{progress}</span>
      </div>
      <div className="sidebar-active-download__bar">
        <div
          className="sidebar-active-download__fill"
          style={{ width: `${pct}%` }}
        />
      </div>
    </button>
  );
}
