import {
  Entity,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
} from "typeorm";
import type { Game } from "./game.entity";

@Entity("download_queue")
export class DownloadQueue {
  @PrimaryGeneratedColumn()
  id: number;

  @OneToOne("Game", "downloadQueue")
  @JoinColumn()
  game: Game;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
