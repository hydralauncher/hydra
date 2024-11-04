import {
  Entity,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Column,
} from "typeorm";

@Entity("seed_list")
export class SeedList {
  @PrimaryGeneratedColumn()
  id: number;

  @Column("text")
  downloadUri: string;

  @Column("boolean", { default: false })
  shouldSeed: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
