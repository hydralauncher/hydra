import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
} from "typeorm";
import { Repack } from "./repack.entity";

import type { GameShop, GameStatus } from "@types";
import { Downloader } from "@shared";
import type { DownloadQueue } from "./download-queue.entity";
import { GameAchievement } from "./game-achievements.entity";

@Entity("game")
export class Game {
  @PrimaryGeneratedColumn()
  id: number;

  @Column("text", { unique: true })
  objectID: string;

  @Column("text", { unique: true, nullable: true })
  remoteId: string | null;

  @Column("text")
  title: string;

  @Column("text", { nullable: true })
  iconUrl: string | null;

  @Column("text", { nullable: true })
  folderName: string | null;

  @Column("text", { nullable: true })
  downloadPath: string | null;

  @Column("text", { nullable: true })
  executablePath: string | null;

  @Column("int", { default: 0 })
  playTimeInMilliseconds: number;

  @Column("text")
  shop: GameShop;

  @Column("text", { nullable: true })
  status: GameStatus | null;

  @Column("int", { default: Downloader.Torrent })
  downloader: Downloader;

  /**
   * Progress is a float between 0 and 1
   */
  @Column("float", { default: 0 })
  progress: number;

  @Column("int", { default: 0 })
  bytesDownloaded: number;

  @Column("datetime", { nullable: true })
  lastTimePlayed: Date | null;

  @Column("float", { default: 0 })
  fileSize: number;

  @Column("text", { nullable: true })
  uri: string | null;

  /**
   * @deprecated
   */
  @OneToOne("Repack", "game", { nullable: true })
  @JoinColumn()
  repack: Repack;

  @OneToOne("GameAchievement", "game")
  achievements: GameAchievement;

  @OneToOne("DownloadQueue", "game")
  downloadQueue: DownloadQueue;

  @Column("boolean", { default: false })
  isDeleted: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
