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

  @Column("text")
  shop: GameShop;

  @Column("text", { nullable: true })
  status: string;

  @Column("float", { default: 0 })
  progress: number;

  @Column("float", { default: 0 })
  fileVerificationProgress: number;

  @Column("int", { default: 0 })
  bytesDownloaded: number;

  @Column("float", { default: 0 })
  fileSize: number;

  @OneToOne(() => Repack, { nullable: true })
  @JoinColumn()
  repack: Repack;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
