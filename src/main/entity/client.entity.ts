import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
  } from "typeorm";
  
  
  @Entity("client")
  export class client {
  
    @PrimaryGeneratedColumn()
    id: number;

    @Column("text", { default: null })
    clientType: string | null;

    @Column("text", { default: null })
    clientHost: string | null;
  
    @Column("text", { default: null })
    clientPort: string | null;
  
    @Column("text", { default: null })
    clientUsername: string | null;
  
    @Column("text", { default: null })
    clientPassword: string | null;
  }