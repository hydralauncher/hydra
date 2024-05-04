import { useState } from "react";
import { ShopDetails } from "@types";
import { ChevronRightIcon, ChevronLeftIcon } from "@primer/octicons-react";
import * as styles from "./game-details.css";


export interface GallerySliderProps {
    gameDetails: ShopDetails | null;
  }

export function GallerySlider({gameDetails}: GallerySliderProps){
    const [imageIndex, setImageIndex] = useState<number>(0)

    const showNextImage = () => {
        setImageIndex((index:number) => {
            if(gameDetails?.screenshots.length && index === (gameDetails?.screenshots.length - 1)) return 0

            return index + 1
        })
    };
    const showPrevImage = () => {
        setImageIndex((index:number) => {
            if(index === 0 && gameDetails?.screenshots) return gameDetails?.screenshots.length - 1
            
            return index - 1
        })
    };



    return (
        <>
        {gameDetails?.screenshots && (
            <div className={styles.gallerySliderContainer}>
            <h2 className={styles.gallerySliderTitle}>Gallery</h2>
            <img className={styles.gallerySliderImage} src={gameDetails?.screenshots[imageIndex].path_full} />
            <button onClick={showPrevImage} className={styles.gallerySliderButton} style={{left: 0}}><ChevronLeftIcon className={styles.gallerySliderIcons}/></button>
            <button onClick={showNextImage} className={styles.gallerySliderButton} style={{right: 0}}><ChevronRightIcon className={styles.gallerySliderIcons}/></button>
        </div>
        )}
        </>
    )

}