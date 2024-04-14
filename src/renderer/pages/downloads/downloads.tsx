import prettyBytes from 'pretty-bytes'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { AsyncImage, Button, TextField } from '@renderer/components'
import { formatDownloadProgress, steamUrlBuilder } from '@renderer/helpers'
import { useDownload, useLibrary } from '@renderer/hooks'
import type { Game } from '@types'

import { useEffect, useState } from 'react'
import * as styles from './downloads.css'

export function Downloads() {
	const { library, updateLibrary } = useLibrary()

	const { t } = useTranslation('downloads')

	const navigate = useNavigate()

	const [filteredLibrary, setFilteredLibrary] = useState<Game[]>([])

	const {
		game: gameDownloading,
		progress,
		isDownloading,
		numPeers,
		numSeeds,
		pauseDownload,
		resumeDownload,
		cancelDownload,
		deleteGame,
		isGameDeleting,
	} = useDownload()

	useEffect(() => {
		setFilteredLibrary(library)
	}, [library])

	const openGame = (gameId: number) =>
		window.electron.openGame(gameId).then(() => {
			updateLibrary()
		})

	const removeGame = (gameId: number) =>
		window.electron.removeGame(gameId).then(() => {
			updateLibrary()
		})

	const getFinalDownloadSize = (game: Game) => {
		const isGameDownloading = isDownloading && gameDownloading?.id === game?.id

		if (!game) return 'N/A'
		if (game.fileSize) return prettyBytes(game.fileSize)

		if (gameDownloading?.fileSize && isGameDownloading) return prettyBytes(gameDownloading.fileSize)

		return game.repack?.fileSize ?? 'N/A'
	}

	const getGameInfo = (game: Game) => {
		const isGameDownloading = isDownloading && gameDownloading?.id === game?.id
		const finalDownloadSize = getFinalDownloadSize(game)

		if (isGameDeleting(game?.id)) {
			return <p>{t('deleting')}</p>
		}

		if (isGameDownloading) {
			return (
				<>
					<p>{progress}</p>

					{gameDownloading?.status !== 'downloading' ? (
						<p>{t(gameDownloading?.status)}</p>
					) : (
						<>
							<p>
								{prettyBytes(gameDownloading?.bytesDownloaded)} / {finalDownloadSize}
							</p>
							<p>
								{numPeers} peers / {numSeeds} seeds
							</p>
						</>
					)}
				</>
			)
		}

		if (game?.status === 'seeding') {
			return (
				<>
					<p>{game?.repack.title}</p>
					<p>{t('completed')}</p>
				</>
			)
		}
		if (game?.status === 'cancelled') return <p>{t('cancelled')}</p>
		if (game?.status === 'downloading_metadata') return <p>{t('starting_download')}</p>

		if (game?.status === 'paused') {
			return (
				<>
					<p>{formatDownloadProgress(game.progress)}</p>
					<p>{t('paused')}</p>
				</>
			)
		}
	}

	const getGameActions = (game: Game) => {
		const isGameDownloading = isDownloading && gameDownloading?.id === game?.id

		const deleting = isGameDeleting(game.id)

		if (isGameDownloading) {
			return (
				<>
					<Button
						onClick={() => pauseDownload(game.id)}
						theme='outline'
					>
						{t('pause')}
					</Button>
					<Button
						onClick={() => cancelDownload(game.id)}
						theme='outline'
					>
						{t('cancel')}
					</Button>
				</>
			)
		}

		if (game?.status === 'paused') {
			return (
				<>
					<Button
						onClick={() => resumeDownload(game.id)}
						theme='outline'
					>
						{t('resume')}
					</Button>
					<Button
						onClick={() => cancelDownload(game.id)}
						theme='outline'
					>
						{t('cancel')}
					</Button>
				</>
			)
		}

		if (game?.status === 'seeding') {
			return (
				<>
					<Button
						onClick={() => openGame(game.id)}
						theme='outline'
						disabled={deleting}
					>
						{t('launch')}
					</Button>
					<Button
						onClick={() => deleteGame(game.id)}
						theme='outline'
						disabled={deleting}
					>
						{t('delete')}
					</Button>
				</>
			)
		}

		if (game?.status === 'downloading_metadata') {
			return (
				<Button
					onClick={() => cancelDownload(game.id)}
					theme='outline'
				>
					{t('cancel')}
				</Button>
			)
		}

		return (
			<>
				<Button
					onClick={() => navigate(`/game/${game.shop}/${game.objectID}`)}
					theme='outline'
					disabled={deleting}
				>
					{t('download_again')}
				</Button>
				<Button
					onClick={() => removeGame(game.id)}
					theme='outline'
					disabled={deleting}
				>
					{t('remove')}
				</Button>
			</>
		)
	}

	const handleFilter: React.ChangeEventHandler<HTMLInputElement> = (event) => {
		setFilteredLibrary(
			library.filter((game) =>
				game.title.toLowerCase().includes(event.target.value.toLocaleLowerCase())
			)
		)
	}

	return (
		<section className={styles.downloadsContainer}>
			<TextField
				placeholder={t('filter')}
				onChange={handleFilter}
			/>

			<ul className={styles.downloads}>
				{filteredLibrary.map((game) => {
					return (
						<li
							key={game.id}
							className={styles.download({
								cancelled: game.status === 'cancelled',
							})}
						>
							<AsyncImage
								src={steamUrlBuilder.library(game.objectID)}
								className={styles.downloadCover}
								alt={game.title}
							/>
							<div className={styles.downloadRightContent}>
								<div className={styles.downloadDetails}>
									<button
										type='button'
										className={styles.downloadTitle}
										onClick={() => navigate(`/game/${game.shop}/${game.objectID}`)}
									>
										{game.title}
									</button>

									{getGameInfo(game)}
								</div>

								<div className={styles.downloadActions}>{getGameActions(game)}</div>
							</div>
						</li>
					)
				})}
			</ul>
		</section>
	)
}
