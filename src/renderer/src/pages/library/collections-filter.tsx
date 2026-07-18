import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import {
  ChevronDownIcon,
  FileDirectoryFillIcon,
  FileDirectoryIcon,
  HeartFillIcon,
  HeartIcon,
  PlusIcon,
} from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import type { GameCollection } from "@types";
import "./collections-filter.scss";

interface CollectionsFilterProps {
  collections: GameCollection[];
  selectedCollectionId: string | null;
  favoritesCollectionId: string;
  onSelect: (collectionId: string | null) => void;
  onCreate: () => void;
  onCollectionContextMenu: (
    event: React.MouseEvent<HTMLElement>,
    collection: GameCollection
  ) => void;
}

export function CollectionsFilter({
  collections,
  selectedCollectionId,
  favoritesCollectionId,
  onSelect,
  onCreate,
  onCollectionContextMenu,
}: Readonly<CollectionsFilterProps>) {
  const { t } = useTranslation(["library", "sidebar"]);

  const selectedCollection = collections.find(
    (collection) => collection.id === selectedCollectionId
  );

  const TriggerIcon = selectedCollection
    ? selectedCollection.id === favoritesCollectionId
      ? HeartFillIcon
      : FileDirectoryFillIcon
    : FileDirectoryIcon;

  return (
    <DropdownMenuPrimitive.Root modal={false}>
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
          <ChevronDownIcon size={12} className="collections-filter__chevron" />
        </button>
      </DropdownMenuPrimitive.Trigger>

      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          align="start"
          sideOffset={6}
          collisionPadding={16}
          className="collections-filter__content"
          onInteractOutside={(event) => {
            const target = event.detail.originalEvent
              .target as HTMLElement | null;
            if (target?.closest(".context-menu, [data-hydra-dialog]")) {
              event.preventDefault();
            }
          }}
        >
          {collections.map((collection) => {
            const isFavorites = collection.id === favoritesCollectionId;
            const isActive = collection.id === selectedCollectionId;

            const CollectionIcon = isFavorites
              ? isActive
                ? HeartFillIcon
                : HeartIcon
              : isActive
                ? FileDirectoryFillIcon
                : FileDirectoryIcon;

            return (
              <DropdownMenuPrimitive.Item
                key={collection.id}
                className={`collections-filter__item${isActive ? " collections-filter__item--active" : ""}`}
                onSelect={() => onSelect(isActive ? null : collection.id)}
                onContextMenu={
                  isFavorites
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
