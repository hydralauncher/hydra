import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
} from "typeorm";
import { UserSubscription } from "./user-subscription.entity";

@Entity("user_auth")
export class UserAuth {
  @PrimaryGeneratedColumn()
  id: number;

  @Column("text", { default: "" })
  userId: string;

  @Column("text", { default: "" })
  displayName: string;

  @Column("text", { nullable: true })
  profileImageUrl: string | null;

  @Column("text", { default: "" })
  accessToken: string;

  @Column("text", { default: "" })
  refreshToken: string;

  @Column("int", { default: 0 })
  tokenExpirationTimestamp: number;

  @OneToOne("UserSubscription", "user")
  subscription: UserSubscription | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
