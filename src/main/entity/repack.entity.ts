import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("repack")
export class Repack {
  @PrimaryGeneratedColumn()
  id: number;

  @Column("text", { unique: true })
  title: string;

  @Column("text", { unique: true })
  magnet: string;

  @Column("int")
  page: number;

  @Column("text")
  repacker: string;

  @Column("text")
  fileSize: string;

  @Column("datetime")
  uploadDate: Date | string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
