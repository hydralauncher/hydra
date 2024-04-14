import { Button, Modal } from '@renderer/components'
import { useTranslation } from 'react-i18next'
import * as styles from './delete-modal.css'

type DeleteModalProps = {
	visible: boolean
	title: string
	description: string
	onClose: () => void
	deleting: boolean
	deleteGame: () => void
}

export function DeleteModal({
	description,
	onClose,
	title,
	visible,
	deleting,
	deleteGame,
}: DeleteModalProps) {
	const { t } = useTranslation('game_details')

	return (
		<Modal
			visible={visible}
			title={title}
			description={description}
			onClose={onClose}
		>
			<div className={styles.deleteActionsButtonsCtn}>
				<Button
					onClick={() => {
						deleteGame()
						onClose()
					}}
					theme='primary'
					disabled={deleting}
				>
					{t('delete')}
				</Button>

				<Button
					onClick={() => {
						onClose()
					}}
					theme='outline'
					disabled={deleting}
				>
					{t('cancel')}
				</Button>
			</div>
		</Modal>
	)
}
