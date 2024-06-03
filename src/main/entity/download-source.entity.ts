import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from "typeorm";
import { Repack } from "./repack.entity";

@Entity("download_source")
export class DownloadSource {
  @PrimaryGeneratedColumn()
  id: number;

  @Column("text", { nullable: true, unique: true })
  url: string;

  @Column("text")
  name: string;

  @OneToMany(() => Repack, (repack) => repack.downloadSource, { cascade: true })
  repacks: Repack[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
