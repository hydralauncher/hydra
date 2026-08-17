import { useMemo, useState, useEffect } from "react";
import { useUserDetails } from "@renderer/hooks";
import { Avatar } from "@renderer/components/avatar/avatar";
import { Modal } from "@renderer/components/modal/modal";
import { TextField } from "@renderer/components/text-field/text-field";
import { Button } from "@renderer/components/button/button";
import {
  AVATAR_DECORATIONS,
  CATEGORY_LABELS,
  DECORATION_CATEGORIES,
  DecorationCategory,
  getDecorationPreviewUrl,
  getDecorationUrl,
} from "@renderer/components/animated-border/avatar-decorations";
import "./decoration-picker-modal.scss";

interface DecorationPickerModalProps {
  visible: boolean;
  currentDecoration: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}

export function DecorationPickerModal({
  visible,
  currentDecoration,
  onSelect,
  onClose,
}: Readonly<DecorationPickerModalProps>) {
  const { userDetails } = useUserDetails();
  const [activeCategory, setActiveCategory] = useState<DecorationCategory>(
    DECORATION_CATEGORIES[0]
  );
  const [search, setSearch] = useState("");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [brokenIds, setBrokenIds] = useState<Set<string>>(new Set());

  const markBroken = (id: string) =>
    setBrokenIds((prev) => new Set([...prev, id]));

  const validCategories = useMemo(() => {
    return DECORATION_CATEGORIES.filter((cat) =>
      AVATAR_DECORATIONS.some((d) => d.category === cat && !brokenIds.has(d.id))
    );
  }, [brokenIds]);

  useEffect(() => {
    if (
      validCategories.length > 0 &&
      !validCategories.includes(activeCategory)
    ) {
      setActiveCategory(validCategories[0]);
    }
  }, [validCategories, activeCategory]);

  const filtered = useMemo(() => {
    const byCategory = AVATAR_DECORATIONS.filter(
      (d) => d.category === activeCategory && !brokenIds.has(d.id)
    );
    if (!search.trim()) return byCategory;
    const q = search.toLowerCase();
    return byCategory.filter((d) => d.label.toLowerCase().includes(q));
  }, [activeCategory, search, brokenIds]);

  useEffect(() => {
    setHoveredId(null);
  }, [activeCategory, search]);

  const handleSelect = (id: string) => {
    onSelect(id);
    onClose();
  };

  const handleRemove = () => {
    onSelect("none");
    onClose();
  };

  return (
    <Modal
      visible={visible}
      title="Escolher Decoração"
      description="Selecione uma decoração animada para o seu avatar"
      onClose={onClose}
      large
      className="decoration-picker-modal"
    >
      <div className="decoration-picker">
        <aside className="decoration-picker__sidebar">
          <TextField
            theme="dark"
            placeholder="Buscar decoração..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Buscar decoração"
          />

          <nav
            className="decoration-picker__categories"
            aria-label="Categorias de decoração"
          >
            {validCategories.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`decoration-picker__category-btn ${activeCategory === cat ? "decoration-picker__category-btn--active" : ""}`}
                onClick={() => {
                  setActiveCategory(cat);
                  setSearch("");
                }}
              >
                {CATEGORY_LABELS[cat]}
              </button>
            ))}
          </nav>

          <div className="decoration-picker__sidebar-footer">
            <Button
              theme="danger"
              onClick={handleRemove}
              title="Remover decoração"
            >
              Remover decoração
            </Button>
          </div>
        </aside>

        <main className="decoration-picker__main">
          <header className="decoration-picker__main-header">
            <h3 className="decoration-picker__main-title">
              {CATEGORY_LABELS[activeCategory]}
            </h3>
            <span className="decoration-picker__count">
              {filtered.length} decoraç{filtered.length === 1 ? "ão" : "ões"}
            </span>
          </header>

          <div
            className="decoration-picker__grid"
            role="listbox"
            aria-label="Decorações disponíveis"
          >
            {filtered.length === 0 && (
              <p className="decoration-picker__empty">
                Nenhuma decoração encontrada.
              </p>
            )}
            {filtered.map((decor) => (
              <button
                key={decor.id}
                type="button"
                role="option"
                aria-selected={currentDecoration === decor.id}
                className={`decoration-picker__item ${currentDecoration === decor.id ? "decoration-picker__item--active" : ""}`}
                onClick={() => handleSelect(decor.id)}
                onMouseEnter={() => setHoveredId(decor.id)}
                onMouseLeave={() => setHoveredId(null)}
                title={decor.label}
              >
                <div className="decoration-picker__item-preview">
                  {hoveredId === decor.id && userDetails && (
                    <div className="decoration-picker__item-avatar-bg">
                      <Avatar
                        size={54}
                        src={userDetails.profileImageUrl}
                        alt={userDetails.displayName}
                      />
                    </div>
                  )}
                  <img
                    className="decoration-picker__item-decoration-img"
                    src={
                      hoveredId === decor.id
                        ? getDecorationUrl(decor.id)
                        : getDecorationPreviewUrl(decor.id)
                    }
                    alt={decor.label}
                    loading="lazy"
                    onError={() => markBroken(decor.id)}
                  />
                </div>
                <span className="decoration-picker__item-label">
                  {decor.label}
                </span>
              </button>
            ))}
          </div>
        </main>
      </div>
    </Modal>
  );
}
