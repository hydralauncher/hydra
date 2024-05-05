import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("user_preferences")
export class UserPreferences {
  @PrimaryGeneratedColumn()
  id: number;

  @Column("text", { nullable: true })
  downloadsPath: string | null;

  @Column("text", { default: "en" })
  language: string;

  @Column("boolean", { default: false })
  downloadNotificationsEnabled: boolean;

  @Column("boolean", { default: false })
  repackUpdatesNotificationsEnabled: boolean;

  @Column("boolean", { default: true })
  telemetryEnabled: boolean;

  @Column("boolean", { default: false })
  preferQuitInsteadOfHiding: boolean;

  @Column("boolean", { default: false })
  runAtStartup: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
