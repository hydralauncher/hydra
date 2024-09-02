import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
} from "typeorm";
import { DownloadSource } from "./download-source.entity";

@Entity("repack")
export class Repack {
  @PrimaryGeneratedColumn()
  id: number;

  @Column("text", { unique: true })
  title: string;

  /**
   * @deprecated Use uris instead
   */
  @Column("text", { unique: true })
  magnet: string;

  @Column("text")
  repacker: string;

  @Column("text")
  fileSize: string;

  @Column("datetime")
  uploadDate: Date | string;

  @ManyToOne(() => DownloadSource, { nullable: true, onDelete: "CASCADE" })
  downloadSource: DownloadSource;

  @Column("text", { default: "[]" })
  uris: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
