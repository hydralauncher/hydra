import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SearchBar, Button, GameCard } from '@renderer/components';
import { useAppDispatch, useAppSelector } from '@renderer/hooks';
import { Plus, Pencil, Trash } from '@primer/octicons-react';
import {
    addCollection,
    updateCollection,
    deleteCollection,
    setActiveCollection
} from '@renderer/features';
import { CollectionModal } from './collection-modal';
import './collections.scss';

type CollectionModalMode = 'create' | 'edit';

export default function Collections() {
    const { t } = useTranslation(['collections', 'common']);
    const navigate = useNavigate();
    const dispatch = useAppDispatch();

    const [searchQuery, setSearchQuery] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalMode, setModalMode] = useState<CollectionModalMode>('create');
    const [editingCollection, setEditingCollection] = useState<string | null>(null);

    const collections = useAppSelector(state => state.collections.collections);
    const activeCollectionId = useAppSelector(state => state.collections.activeCollectionId);
    const library = useAppSelector(state => state.library.value);

    const filteredCollections = searchQuery
        ? collections.filter(collection =>
            collection.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (collection.description && collection.description.toLowerCase().includes(searchQuery.toLowerCase()))
        )
        : collections;

    const activeCollection = collections.find(c => c.id === activeCollectionId);
    const collectionGames = activeCollection
        ? library.filter(game => activeCollection.gameIds.includes(game.id))
        : [];

    const handleSearch = (query: string) => {
        setSearchQuery(query);
    };

    const openCreateModal = () => {
        setModalMode('create');
        setEditingCollection(null);
        setIsModalOpen(true);
    };

    const openEditModal = (collectionId: string) => {
        setModalMode('edit');
        setEditingCollection(collectionId);
        setIsModalOpen(true);
    };

    const handleDeleteCollection = (collectionId: string) => {
        if (window.confirm(t('delete_collection_confirm'))) {
            dispatch(deleteCollection(collectionId));
        }
    };

    const handleSelectCollection = (collectionId: string) => {
        dispatch(setActiveCollection(collectionId));
    };

    return (
        <div className="collections">
            <div className="collections__sidebar">
                <div className="collections__sidebar-header">
                    <h2>{t('my_collections')}</h2>
                    <Button onClick={openCreateModal} theme="outline" size="small">
                        <Plus size={16} />
                        {t('create_collection')}
                    </Button>
                </div>

                <SearchBar
                    onSearch={handleSearch}
                    placeholder={t('search_collections')}
                    className="collections__search"
                />

                <ul className="collections__list">
                    {filteredCollections.length > 0 ? (
                        filteredCollections.map(collection => (
                            <li
                                key={collection.id}
                                className={`collections__list-item ${activeCollectionId === collection.id ? 'active' : ''}`}
                                onClick={() => handleSelectCollection(collection.id)}
                            >
                                <div className="collections__list-item-info">
                                    <h3>{collection.name}</h3>
                                    <span>{collection.gameIds.length} {t('games')}</span>
                                </div>
                                <div className="collections__list-item-actions">
                                    <button
                                        className="collections__action-button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            openEditModal(collection.id);
                                        }}
                                    >
                                        <Pencil size={16} />
                                    </button>
                                    <button
                                        className="collections__action-button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleDeleteCollection(collection.id);
                                        }}
                                    >
                                        <Trash size={16} />
                                    </button>
                                </div>
                            </li>
                        ))
                    ) : (
                        <div className="collections__empty">
                            {searchQuery
                                ? t('no_collections_found')
                                : t('no_collections_yet')}
                        </div>
                    )}
                </ul>
            </div>

            <div className="collections__content">
                {activeCollection ? (
                    <>
                        <div className="collections__content-header">
                            <h2>{activeCollection.name}</h2>
                            {activeCollection.description && (
                                <p className="collections__description">{activeCollection.description}</p>
                            )}
                        </div>

                        {collectionGames.length > 0 ? (
                            <div className="collections__games">
                                {collectionGames.map(game => (
                                    <GameCard
                                        key={game.id}
                                        game={game}
                                        onClick={() => navigate(`/game/${game.shop}/${game.objectId}`)}
                                    />
                                ))}
                            </div>
                        ) : (
                            <div className="collections__empty-collection">
                                <p>{t('empty_collection')}</p>
                                <Button
                                    onClick={() => navigate('/catalogue')}
                                    theme="primary"
                                >
                                    {t('browse_games')}
                                </Button>
                            </div>
                        )}
                    </>
                ) : (
                    <div className="collections__select-prompt">
                        <p>{t('select_collection')}</p>
                    </div>
                )}
            </div>

            {isModalOpen && (
                <CollectionModal
                    mode={modalMode}
                    collectionId={editingCollection}
                    onClose={() => setIsModalOpen(false)}
                />
            )}
        </div>
    );
} 