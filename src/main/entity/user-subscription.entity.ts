import type { SubscriptionStatus } from "@types";
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
} from "typeorm";
import { UserAuth } from "./user-auth.entity";

@Entity("user_subscription")
export class UserSubscription {
  @PrimaryGeneratedColumn()
  id: number;

  @Column("text", { default: "" })
  subscriptionId: string;

  @OneToOne("UserAuth", "subscription")
  @JoinColumn()
  user: UserAuth;

  @Column("text", { default: "" })
  status: SubscriptionStatus;

  @Column("text", { default: "" })
  planId: string;

  @Column("text", { default: "" })
  planName: string;

  @Column("datetime", { nullable: true })
  expiresAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
