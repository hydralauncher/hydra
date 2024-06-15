import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("user_auth")
export class UserAuth {
  @PrimaryGeneratedColumn()
  id: number;

  @Column("text", { default: "" })
  userId: string;

  @Column("text", { default: "" })
  displayName: string;

  @Column("text", { default: "" })
  profileImageUrl: string;

  @Column("text", { default: "" })
  accessToken: string;

  @Column("text", { default: "" })
  refreshToken: string;

  @Column("int", { default: 0 })
  tokenExpirationTimestamp: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
