import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
} from "typeorm";
import type { GameShop } from "@types";
import { Repack } from "./repack.entity";
import { GameStatus } from "@globals";

@Entity("game")
export class Game {
  @PrimaryGeneratedColumn()
  id: number;

  @Column("text", { unique: true })
  objectID: string;

  @Column("text")
  title: string;

  @Column("text")
  iconUrl: string;

  @Column("text", { nullable: true })
  folderName: string | null;

  @Column("text", { nullable: true })
  downloadPath: string | null;

  @Column("text", { nullable: true })
  executablePath: string | null;

  @Column("text", { nullable: true })
  rarPath: string | null;

  @Column("int", { default: 0 })
  playTimeInMilliseconds: number;

  @Column("text")
  shop: GameShop;

  @Column("text", { nullable: true })
  status: GameStatus | null;

  /**
   * Progress is a float between 0 and 1
   */
  @Column("float", { default: 0 })
  progress: number;

  @Column("float", { default: 0 })
  fileVerificationProgress: number;

  @Column("float", { default: 0 })
  decompressionProgress: number;

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
