import { useState } from "react";
import { ShopDetails, SteamMovies, SteamScreenshot } from "@types";
import { ChevronRightIcon, ChevronLeftIcon } from "@primer/octicons-react";
import * as styles from "./game-details.css";
import { useTranslation } from "react-i18next";


export interface GallerySliderProps {
    gameDetails: ShopDetails | null;
}

export function GallerySlider({ gameDetails }: GallerySliderProps) {
    const [mediaIndex, setMediaIndex] = useState<number>(0);
    const [mediaType, setMediaType] = useState<'video' | 'image'>('video');
    const { t } = useTranslation("game_details");

    const showNextImage = () => {
        setMediaIndex((index: number) => {
            if (gameDetails?.movies.length && index === (gameDetails?.movies.length - 1) && mediaType === 'video') {
                setMediaType('image')
                return 1
            }
            if (gameDetails?.screenshots.length && index === (gameDetails?.screenshots.length - 1) && mediaType === 'image') {
                setMediaType('video')
                return 0
            }

            return index + 1
        })
    };
    const showPrevImage = () => {
        setMediaIndex((index: number) => {
            if (gameDetails?.screenshots.length && index === 0 && mediaType === 'video') {
                setMediaType('image')
                return gameDetails?.screenshots.length - 1
            }
            if (gameDetails?.movies.length && index === 1 && mediaType === 'image') {
                setMediaType('video')
                return gameDetails?.movies.length - 1
            }

            return index - 1
        })
    };

    return (
        <>
            {gameDetails?.screenshots && (
                <div className={styles.gallerySliderContainer}>
                    <h2 className={styles.gallerySliderTitle}>{t('gallery')}</h2>
                    <div className={styles.gallerySliderAnimationContainer}>
                        {gameDetails.movies.map((video: SteamMovies) => (
                            <video controls className={styles.gallerySliderMedia} poster={video.thumbnail} style={{ translate: `${-100 * mediaIndex}%` }}>
                                <source src={video.webm.max.replace('http', 'https')} />
                            </video>
                        ))}
                        {gameDetails.screenshots.map((image: SteamScreenshot) => (
                            <img className={styles.gallerySliderMedia} src={image.path_full} style={{ translate: `${-100 * mediaIndex}%` }} />
                        ))}
                    </div>
                    <button onClick={showPrevImage} className={styles.gallerySliderButton} style={{ left: 0 }}><ChevronLeftIcon className={styles.gallerySliderIcons} /></button>
                    <button onClick={showNextImage} className={styles.gallerySliderButton} style={{ right: 0 }}><ChevronRightIcon className={styles.gallerySliderIcons} /></button>
                </div>
            )}
        </>
    )

}