import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import {
  ChevronDownIcon,
  FileDirectoryFillIcon,
  FileDirectoryIcon,
  HeartFillIcon,
  HeartIcon,
  LockIcon,
  PlusIcon,
} from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import type { GameCollection } from "@types";
import { useCloseOnLibraryScroll } from "./use-close-on-library-scroll";
import {
  LIBRARY_DROPDOWN_CHEVRON_SIZE,
  LIBRARY_DROPDOWN_COLLISION_PADDING,
  LIBRARY_DROPDOWN_SIDE_OFFSET,
} from "./library-dropdown";
import "./collections-filter.scss";

interface CollectionsFilterProps {
  collections: GameCollection[];
  selectedCollectionId: string | null;
  favoritesCollectionId: string;
  hiddenCollectionId: string;
  onSelect: (collectionId: string | null) => void;
  onCreate: () => void;
  onCollectionContextMenu: (
    event: React.MouseEvent<HTMLElement>,
    collection: GameCollection
  ) => void;
}

const getTriggerIcon = (
  selectedCollection: GameCollection | undefined,
  favoritesCollectionId: string,
  hiddenCollectionId: string
) => {
  if (!selectedCollection) return FileDirectoryIcon;
  if (selectedCollection.id === favoritesCollectionId) return HeartFillIcon;
  if (selectedCollection.id === hiddenCollectionId) return LockIcon;
  return FileDirectoryFillIcon;
};

const getCollectionIcon = (
  isFavorites: boolean,
  isHidden: boolean,
  isActive: boolean
) => {
  if (isFavorites) {
    return isActive ? HeartFillIcon : HeartIcon;
  }
  if (isHidden) return LockIcon;
  return isActive ? FileDirectoryFillIcon : FileDirectoryIcon;
};

export function CollectionsFilter({
  collections,
  selectedCollectionId,
  favoritesCollectionId,
  hiddenCollectionId,
  onSelect,
  onCreate,
  onCollectionContextMenu,
}: Readonly<CollectionsFilterProps>) {
  const { t } = useTranslation(["library", "sidebar"]);

  const [open, setOpen] = useCloseOnLibraryScroll();

  const selectedCollection = collections.find(
    (collection) => collection.id === selectedCollectionId
  );

  const TriggerIcon = getTriggerIcon(
    selectedCollection,
    favoritesCollectionId,
    hiddenCollectionId
  );

  return (
    <DropdownMenuPrimitive.Root
      modal={false}
      open={open}
      onOpenChange={setOpen}
    >
      <DropdownMenuPrimitive.Trigger asChild>
        <button
          type="button"
          className="collections-filter__trigger"
          aria-label={t("collections")}
        >
          <TriggerIcon size={16} />
          <span className="collections-filter__trigger-label">
            {selectedCollection ? selectedCollection.name : t("collections")}
          </span>
          <ChevronDownIcon
            size={LIBRARY_DROPDOWN_CHEVRON_SIZE}
            className="collections-filter__chevron"
          />
        </button>
      </DropdownMenuPrimitive.Trigger>

      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          align="start"
          sideOffset={LIBRARY_DROPDOWN_SIDE_OFFSET}
          collisionPadding={LIBRARY_DROPDOWN_COLLISION_PADDING}
          className="collections-filter__content"
          onInteractOutside={(event) => {
            const target = event.detail.originalEvent
              .target as HTMLElement | null;
            if (target?.closest(".context-menu, [data-hydra-dialog]")) {
              event.preventDefault();
            }
          }}
        >
          <div className="collections-filter__list">
            {collections.map((collection) => {
              const isFavorites = collection.id === favoritesCollectionId;
              const isHidden = collection.id === hiddenCollectionId;
              const isActive = collection.id === selectedCollectionId;

              const CollectionIcon = getCollectionIcon(
                isFavorites,
                isHidden,
                isActive
              );

              return (
                <DropdownMenuPrimitive.Item
                  key={collection.id}
                  className={`collections-filter__item${isActive ? " collections-filter__item--active" : ""}`}
                  onSelect={() => onSelect(isActive ? null : collection.id)}
                  onContextMenu={
                    isFavorites || isHidden
                      ? undefined
                      : (event) => onCollectionContextMenu(event, collection)
                  }
                >
                  <CollectionIcon size={16} />
                  <span className="collections-filter__item-label">
                    {collection.name}
                  </span>
                  <span className="collections-filter__item-count">
                    {collection.gamesCount}
                  </span>
                </DropdownMenuPrimitive.Item>
              );
            })}
          </div>

          <DropdownMenuPrimitive.Separator className="collections-filter__separator" />

          <DropdownMenuPrimitive.Item
            className="collections-filter__item"
            onSelect={(event) => {
              event.preventDefault();
              onCreate();
            }}
          >
            <PlusIcon size={16} />
            <span className="collections-filter__item-label">
              {t("create_collection", { ns: "sidebar" })}
            </span>
          </DropdownMenuPrimitive.Item>
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
