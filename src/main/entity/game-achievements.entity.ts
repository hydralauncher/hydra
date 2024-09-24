import {
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import type { Game } from "./game.entity";

@Entity("game_achievement")
export class GameAchievement {
  @PrimaryGeneratedColumn()
  id: number;

  @OneToOne("Game", "achievements")
  @JoinColumn()
  game: Game;

  @Column("text", { nullable: true })
  unlockedAchievements: string;

  @Column("text", { nullable: true })
  achievements: string;
}
