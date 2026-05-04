import { useDragLayer } from "react-dnd";
import "./sidebar-drag-layer.scss";

export function SidebarDragLayer() {
  const { isDragging, item, currentOffset } = useDragLayer((monitor) => ({
    isDragging: monitor.isDragging(),
    item: monitor.getItem(),
    currentOffset: monitor.getClientOffset(),
  }));

  if (!isDragging || !currentOffset || !item?.title) {
    return null;
  }

  return (
    <div className="sidebar-drag-layer">
      <div
        className="sidebar-drag-layer__card"
        style={{
          left: currentOffset.x - 20,
          top: currentOffset.y - 18,
        }}
      >
        {item.icon ? (
          <img
            className="sidebar-drag-layer__icon"
            src={item.icon}
            alt={item.title}
          />
        ) : (
          <div className="sidebar-drag-layer__icon-placeholder" />
        )}
        <span className="sidebar-drag-layer__title">{item.title}</span>
      </div>
    </div>
  );
}
