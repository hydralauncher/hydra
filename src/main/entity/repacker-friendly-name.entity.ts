import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("repacker_friendly_name")
export class RepackerFriendlyName {
  @PrimaryGeneratedColumn()
  id: number;

  @Column("text", { unique: true })
  name: string;

  @Column("text")
  friendlyName: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
