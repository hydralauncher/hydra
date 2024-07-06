import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToMany,
  JoinTable,
} from "typeorm";
import { Game } from "./game.entity";

@Entity("collection")
export class Collection {
  @PrimaryGeneratedColumn()
  id: number;

  @Column("text", { unique: true })
  title: string;

  @ManyToMany("Game", "collections")
  @JoinTable()
  games: Game[];
}
