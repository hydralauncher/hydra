import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity("game_achievement")
export class GameAchievement {
  @PrimaryGeneratedColumn()
  id: number;

  @Column("text")
  objectId: string;

  @Column("text")
  shop: string;

  @Column("text", { nullable: true })
  unlockedAchievements: string | null;

  @Column("text", { nullable: true })
  achievements: string | null;
}
