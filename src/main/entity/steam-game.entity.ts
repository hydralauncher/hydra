import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity("steam_game")
export class SteamGame {
  @PrimaryColumn()
  id: number;

  @Column()
  name: string;
}
