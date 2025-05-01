import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, TextField } from '@renderer/components';
import { useAppDispatch, useAppSelector } from '@renderer/hooks';
import { addCollection, updateCollection } from '@renderer/features';
import './collection-modal.scss';

interface CollectionModalProps {
    mode: 'create' | 'edit';
    collectionId: string | null;
    onClose: () => void;
}

export function CollectionModal({ mode, collectionId, onClose }: CollectionModalProps) {
    const { t } = useTranslation(['collections', 'common']);
    const dispatch = useAppDispatch();

    const collections = useAppSelector(state => state.collections.collections);
    const editCollection = collectionId ? collections.find(c => c.id === collectionId) : null;

    const [name, setName] = useState(editCollection?.name || '');
    const [description, setDescription] = useState(editCollection?.description || '');
    const [error, setError] = useState('');

    const handleSave = () => {
        if (!name.trim()) {
            setError(t('name_required'));
            return;
        }

        // Check for duplicate names (except the current collection if editing)
        const isDuplicate = collections.some(
            c => c.name.toLowerCase() === name.toLowerCase() && c.id !== collectionId
        );

        if (isDuplicate) {
            setError(t('name_already_exists'));
            return;
        }

        if (mode === 'create') {
            dispatch(addCollection({
                id: crypto.randomUUID(),
                name: name.trim(),
                description: description.trim() || undefined,
                gameIds: [],
                createdAt: Date.now(),
                updatedAt: Date.now()
            }));
        } else if (mode === 'edit' && editCollection) {
            dispatch(updateCollection({
                ...editCollection,
                name: name.trim(),
                description: description.trim() || undefined,
                updatedAt: Date.now()
            }));
        }

        onClose();
    };

    return (
        <Modal
            title={mode === 'create' ? t('create_collection') : t('edit_collection')}
            onClose={onClose}
            actions={[
                { label: t('common:cancel'), onClick: onClose, theme: 'outline' },
                { label: t('common:save'), onClick: handleSave, theme: 'primary' }
            ]}
        >
            <div className="collection-modal">
                <TextField
                    label={t('collection_name')}
                    value={name}
                    onChange={e => setName(e.target.value)}
                    error={error}
                    autoFocus
                />

                <TextField
                    label={t('collection_description')}
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder={t('collection_description_placeholder')}
                    multiline
                />
            </div>
        </Modal>
    );
} 