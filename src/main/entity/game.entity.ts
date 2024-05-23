import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { Repack } from "./repack.entity";

import { Downloader, GameStatus } from "@shared";
import type { GameShop } from "@types";

@Entity("game")
export class Game {
  @PrimaryGeneratedColumn()
  id: number;

  @Column("text", { unique: true })
  objectID: string;

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

  @Column("float", { default: 0 })
  fileVerificationProgress: number;

  @Column("int", { default: 0 })
  bytesDownloaded: number;

  @Column("text", { nullable: true })
  lastTimePlayed: Date | null;

  @Column("float", { default: 0 })
  fileSize: number;

  @OneToOne(() => Repack, { nullable: true })
  @JoinColumn()
  repack: Repack;

  @Column("boolean", { default: false })
  isDeleted: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
