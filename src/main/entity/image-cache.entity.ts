import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("image_cache")
export class ImageCache {
  @PrimaryGeneratedColumn()
  id: number;

  @Column("text", { unique: true })
  url: string;

  @Column("text")
  data: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
