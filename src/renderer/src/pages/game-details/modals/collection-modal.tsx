import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, TextField, Button } from '@renderer/components';
import { useCollections, useToast } from '@renderer/hooks';
import { Plus } from '@primer/octicons-react';
import './collection-modal.scss';

interface CollectionModalProps {
    gameId: string;
    onClose: () => void;
}

export function CollectionModal({ gameId, onClose }: CollectionModalProps) {
    const { t } = useTranslation(['collections', 'common']);
    const {
        collections,
        createCollection,
        addToCollection,
        removeFromCollection,
        isGameInCollection
    } = useCollections();
    const { showSuccessToast } = useToast();

    const [isCreatingCollection, setIsCreatingCollection] = useState(false);
    const [newCollectionName, setNewCollectionName] = useState('');
    const [newCollectionDescription, setNewCollectionDescription] = useState('');
    const [error, setError] = useState('');

    const handleCreateCollection = () => {
        if (!newCollectionName.trim()) {
            setError(t('collections:name_required'));
            return;
        }

        // Check for duplicate names
        const isDuplicate = collections.some(
            c => c.name.toLowerCase() === newCollectionName.toLowerCase()
        );

        if (isDuplicate) {
            setError(t('collections:name_already_exists'));
            return;
        }

        const collectionId = createCollection(
            newCollectionName.trim(),
            newCollectionDescription.trim() || undefined
        );

        // Add the game to the newly created collection
        addToCollection(collectionId, gameId);

        // Reset form and exit creation mode
        setNewCollectionName('');
        setNewCollectionDescription('');
        setIsCreatingCollection(false);

        showSuccessToast(t('collections:collection_created'));
    };

    const handleToggleCollection = (collectionId: string) => {
        if (isGameInCollection(collectionId, gameId)) {
            removeFromCollection(collectionId, gameId);
            showSuccessToast(t('collections:removed_from_collection'));
        } else {
            addToCollection(collectionId, gameId);
            showSuccessToast(t('collections:added_to_collection'));
        }
    };

    return (
        <Modal
            title={t('collections:manage_collections')}
            onClose={onClose}
            className="collections-modal"
        >
            {isCreatingCollection ? (
                <div className="collections-modal__create-form">
                    <TextField
                        label={t('collections:collection_name')}
                        value={newCollectionName}
                        onChange={e => setNewCollectionName(e.target.value)}
                        error={error}
                        autoFocus
                    />

                    <TextField
                        label={t('collections:collection_description')}
                        value={newCollectionDescription}
                        onChange={e => setNewCollectionDescription(e.target.value)}
                        placeholder={t('collections:collection_description_placeholder')}
                        multiline
                    />

                    <div className="collections-modal__actions">
                        <Button
                            theme="outline"
                            onClick={() => setIsCreatingCollection(false)}
                        >
                            {t('common:cancel')}
                        </Button>
                        <Button
                            theme="primary"
                            onClick={handleCreateCollection}
                        >
                            {t('common:create')}
                        </Button>
                    </div>
                </div>
            ) : (
                <>
                    <div className="collections-modal__header">
                        <p>{t('collections:select_collection_prompt')}</p>
                        <Button
                            theme="outline"
                            size="small"
                            onClick={() => setIsCreatingCollection(true)}
                        >
                            <Plus size={16} />
                            {t('collections:create_new_collection')}
                        </Button>
                    </div>

                    {collections.length > 0 ? (
                        <ul className="collections-modal__list">
                            {collections.map(collection => (
                                <li
                                    key={collection.id}
                                    className="collections-modal__list-item"
                                    onClick={() => handleToggleCollection(collection.id)}
                                >
                                    <div className="collections-modal__list-item-info">
                                        <h3>{collection.name}</h3>
                                        <span>{collection.gameIds.length} {t('collections:games')}</span>
                                    </div>
                                    <div className="collections-modal__checkbox">
                                        <input
                                            type="checkbox"
                                            checked={isGameInCollection(collection.id, gameId)}
                                            readOnly
                                        />
                                    </div>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <div className="collections-modal__empty">
                            {t('collections:no_collections_yet')}
                        </div>
                    )}
                </>
            )}
        </Modal>
    );
} 