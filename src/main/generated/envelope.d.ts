import type { BinaryWriteOptions } from "@protobuf-ts/runtime";
import type { IBinaryWriter } from "@protobuf-ts/runtime";
import type { BinaryReadOptions } from "@protobuf-ts/runtime";
import type { IBinaryReader } from "@protobuf-ts/runtime";
import type { PartialMessage } from "@protobuf-ts/runtime";
import { MessageType } from "@protobuf-ts/runtime";
/**
 * @generated from protobuf message FriendRequest
 */
export interface FriendRequest {
  /**
   * @generated from protobuf field: int32 friend_request_count = 1
   */
  friendRequestCount: number;
  /**
   * @generated from protobuf field: optional string sender_id = 2
   */
  senderId?: string;
}
/**
 * @generated from protobuf message FriendGameSession
 */
export interface FriendGameSession {
  /**
   * @generated from protobuf field: string object_id = 1
   */
  objectId: string;
  /**
   * @generated from protobuf field: string shop = 2
   */
  shop: string;
  /**
   * @generated from protobuf field: string friend_id = 3
   */
  friendId: string;
}
/**
 * @generated from protobuf message Notification
 */
export interface Notification {
  /**
   * @generated from protobuf field: int32 notification_count = 1
   */
  notificationCount: number;
}
/**
 * @generated from protobuf message Envelope
 */
export interface Envelope {
  /**
   * @generated from protobuf oneof: payload
   */
  payload:
    | {
        oneofKind: "friendRequest";
        /**
         * @generated from protobuf field: FriendRequest friend_request = 1
         */
        friendRequest: FriendRequest;
      }
    | {
        oneofKind: "friendGameSession";
        /**
         * @generated from protobuf field: FriendGameSession friend_game_session = 2
         */
        friendGameSession: FriendGameSession;
      }
    | {
        oneofKind: "notification";
        /**
         * @generated from protobuf field: Notification notification = 3
         */
        notification: Notification;
      }
    | {
        oneofKind: undefined;
      };
}
declare class FriendRequest$Type extends MessageType<FriendRequest> {
  constructor();
  create(value?: PartialMessage<FriendRequest>): FriendRequest;
  internalBinaryRead(
    reader: IBinaryReader,
    length: number,
    options: BinaryReadOptions,
    target?: FriendRequest
  ): FriendRequest;
  internalBinaryWrite(
    message: FriendRequest,
    writer: IBinaryWriter,
    options: BinaryWriteOptions
  ): IBinaryWriter;
}
/**
 * @generated MessageType for protobuf message FriendRequest
 */
export declare const FriendRequest: FriendRequest$Type;
declare class FriendGameSession$Type extends MessageType<FriendGameSession> {
  constructor();
  create(value?: PartialMessage<FriendGameSession>): FriendGameSession;
  internalBinaryRead(
    reader: IBinaryReader,
    length: number,
    options: BinaryReadOptions,
    target?: FriendGameSession
  ): FriendGameSession;
  internalBinaryWrite(
    message: FriendGameSession,
    writer: IBinaryWriter,
    options: BinaryWriteOptions
  ): IBinaryWriter;
}
/**
 * @generated MessageType for protobuf message FriendGameSession
 */
export declare const FriendGameSession: FriendGameSession$Type;
declare class Notification$Type extends MessageType<Notification> {
  constructor();
  create(value?: PartialMessage<Notification>): Notification;
  internalBinaryRead(
    reader: IBinaryReader,
    length: number,
    options: BinaryReadOptions,
    target?: Notification
  ): Notification;
  internalBinaryWrite(
    message: Notification,
    writer: IBinaryWriter,
    options: BinaryWriteOptions
  ): IBinaryWriter;
}
/**
 * @generated MessageType for protobuf message Notification
 */
export declare const Notification: Notification$Type;
declare class Envelope$Type extends MessageType<Envelope> {
  constructor();
  create(value?: PartialMessage<Envelope>): Envelope;
  internalBinaryRead(
    reader: IBinaryReader,
    length: number,
    options: BinaryReadOptions,
    target?: Envelope
  ): Envelope;
  internalBinaryWrite(
    message: Envelope,
    writer: IBinaryWriter,
    options: BinaryWriteOptions
  ): IBinaryWriter;
}
/**
 * @generated MessageType for protobuf message Envelope
 */
export declare const Envelope: Envelope$Type;
export {};
