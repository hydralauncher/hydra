import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from "typeorm";
import { Repack } from "./repack.entity";
import { DownloadSourceStatus } from "@shared";

@Entity("download_source")
export class DownloadSource {
  @PrimaryGeneratedColumn()
  id: number;

  @Column("text", { nullable: true, unique: true })
  url: string;

  @Column("text")
  name: string;

  @Column("text", { nullable: true })
  etag: string | null;

  @Column("text", { default: "online" })
  status: DownloadSourceStatus;

  @OneToMany(() => Repack, (repack) => repack.downloadSource, { cascade: true })
  repacks: Repack[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
