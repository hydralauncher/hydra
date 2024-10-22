import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";
import type { GameShop } from "@types";

@Entity("game_shop_cache")
export class GameShopCache {
  @PrimaryColumn("text", { unique: true })
  objectID: string;

  @Column("text")
  shop: GameShop;

  @Column("text", { nullable: true })
  serializedData: string;

  /**
   * @deprecated Use IndexedDB's `howLongToBeatEntries` instead
   */
  @Column("text", { nullable: true })
  howLongToBeatSerializedData: string;

  @Column("text", { nullable: true })
  language: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
