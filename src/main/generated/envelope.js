import { WireType } from "@protobuf-ts/runtime";
import { UnknownFieldHandler } from "@protobuf-ts/runtime";
import { reflectionMergePartial } from "@protobuf-ts/runtime";
import { MessageType } from "@protobuf-ts/runtime";
// @generated message type with reflection information, may provide speed optimized methods
class FriendRequest$Type extends MessageType {
  constructor() {
    super("FriendRequest", [
      {
        no: 1,
        name: "friend_request_count",
        kind: "scalar",
        T: 5 /*ScalarType.INT32*/,
      },
      {
        no: 2,
        name: "sender_id",
        kind: "scalar",
        opt: true,
        T: 9 /*ScalarType.STRING*/,
      },
    ]);
  }
  create(value) {
    const message = globalThis.Object.create(this.messagePrototype);
    message.friendRequestCount = 0;
    if (value !== undefined) reflectionMergePartial(this, message, value);
    return message;
  }
  internalBinaryRead(reader, length, options, target) {
    let message = target ?? this.create(),
      end = reader.pos + length;
    while (reader.pos < end) {
      let [fieldNo, wireType] = reader.tag();
      switch (fieldNo) {
        case /* int32 friend_request_count */ 1:
          message.friendRequestCount = reader.int32();
          break;
        case /* optional string sender_id */ 2:
          message.senderId = reader.string();
          break;
        default:
          let u = options.readUnknownField;
          if (u === "throw")
            throw new globalThis.Error(
              `Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`
            );
          let d = reader.skip(wireType);
          if (u !== false)
            (u === true ? UnknownFieldHandler.onRead : u)(
              this.typeName,
              message,
              fieldNo,
              wireType,
              d
            );
      }
    }
    return message;
  }
  internalBinaryWrite(message, writer, options) {
    /* int32 friend_request_count = 1; */
    if (message.friendRequestCount !== 0)
      writer.tag(1, WireType.Varint).int32(message.friendRequestCount);
    /* optional string sender_id = 2; */
    if (message.senderId !== undefined)
      writer.tag(2, WireType.LengthDelimited).string(message.senderId);
    let u = options.writeUnknownFields;
    if (u !== false)
      (u == true ? UnknownFieldHandler.onWrite : u)(
        this.typeName,
        message,
        writer
      );
    return writer;
  }
}
/**
 * @generated MessageType for protobuf message FriendRequest
 */
export const FriendRequest = new FriendRequest$Type();
// @generated message type with reflection information, may provide speed optimized methods
class FriendGameSession$Type extends MessageType {
  constructor() {
    super("FriendGameSession", [
      { no: 1, name: "object_id", kind: "scalar", T: 9 /*ScalarType.STRING*/ },
      { no: 2, name: "shop", kind: "scalar", T: 9 /*ScalarType.STRING*/ },
      { no: 3, name: "friend_id", kind: "scalar", T: 9 /*ScalarType.STRING*/ },
    ]);
  }
  create(value) {
    const message = globalThis.Object.create(this.messagePrototype);
    message.objectId = "";
    message.shop = "";
    message.friendId = "";
    if (value !== undefined) reflectionMergePartial(this, message, value);
    return message;
  }
  internalBinaryRead(reader, length, options, target) {
    let message = target ?? this.create(),
      end = reader.pos + length;
    while (reader.pos < end) {
      let [fieldNo, wireType] = reader.tag();
      switch (fieldNo) {
        case /* string object_id */ 1:
          message.objectId = reader.string();
          break;
        case /* string shop */ 2:
          message.shop = reader.string();
          break;
        case /* string friend_id */ 3:
          message.friendId = reader.string();
          break;
        default:
          let u = options.readUnknownField;
          if (u === "throw")
            throw new globalThis.Error(
              `Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`
            );
          let d = reader.skip(wireType);
          if (u !== false)
            (u === true ? UnknownFieldHandler.onRead : u)(
              this.typeName,
              message,
              fieldNo,
              wireType,
              d
            );
      }
    }
    return message;
  }
  internalBinaryWrite(message, writer, options) {
    /* string object_id = 1; */
    if (message.objectId !== "")
      writer.tag(1, WireType.LengthDelimited).string(message.objectId);
    /* string shop = 2; */
    if (message.shop !== "")
      writer.tag(2, WireType.LengthDelimited).string(message.shop);
    /* string friend_id = 3; */
    if (message.friendId !== "")
      writer.tag(3, WireType.LengthDelimited).string(message.friendId);
    let u = options.writeUnknownFields;
    if (u !== false)
      (u == true ? UnknownFieldHandler.onWrite : u)(
        this.typeName,
        message,
        writer
      );
    return writer;
  }
}
/**
 * @generated MessageType for protobuf message FriendGameSession
 */
export const FriendGameSession = new FriendGameSession$Type();
// @generated message type with reflection information, may provide speed optimized methods
class Notification$Type extends MessageType {
  constructor() {
    super("Notification", [
      {
        no: 1,
        name: "notification_count",
        kind: "scalar",
        T: 5 /*ScalarType.INT32*/,
      },
    ]);
  }
  create(value) {
    const message = globalThis.Object.create(this.messagePrototype);
    message.notificationCount = 0;
    if (value !== undefined) reflectionMergePartial(this, message, value);
    return message;
  }
  internalBinaryRead(reader, length, options, target) {
    let message = target ?? this.create(),
      end = reader.pos + length;
    while (reader.pos < end) {
      let [fieldNo, wireType] = reader.tag();
      switch (fieldNo) {
        case /* int32 notification_count */ 1:
          message.notificationCount = reader.int32();
          break;
        default:
          let u = options.readUnknownField;
          if (u === "throw")
            throw new globalThis.Error(
              `Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`
            );
          let d = reader.skip(wireType);
          if (u !== false)
            (u === true ? UnknownFieldHandler.onRead : u)(
              this.typeName,
              message,
              fieldNo,
              wireType,
              d
            );
      }
    }
    return message;
  }
  internalBinaryWrite(message, writer, options) {
    /* int32 notification_count = 1; */
    if (message.notificationCount !== 0)
      writer.tag(1, WireType.Varint).int32(message.notificationCount);
    let u = options.writeUnknownFields;
    if (u !== false)
      (u == true ? UnknownFieldHandler.onWrite : u)(
        this.typeName,
        message,
        writer
      );
    return writer;
  }
}
/**
 * @generated MessageType for protobuf message Notification
 */
export const Notification = new Notification$Type();
// @generated message type with reflection information, may provide speed optimized methods
class Envelope$Type extends MessageType {
  constructor() {
    super("Envelope", [
      {
        no: 1,
        name: "friend_request",
        kind: "message",
        oneof: "payload",
        T: () => FriendRequest,
      },
      {
        no: 2,
        name: "friend_game_session",
        kind: "message",
        oneof: "payload",
        T: () => FriendGameSession,
      },
      {
        no: 3,
        name: "notification",
        kind: "message",
        oneof: "payload",
        T: () => Notification,
      },
    ]);
  }
  create(value) {
    const message = globalThis.Object.create(this.messagePrototype);
    message.payload = { oneofKind: undefined };
    if (value !== undefined) reflectionMergePartial(this, message, value);
    return message;
  }
  internalBinaryRead(reader, length, options, target) {
    let message = target ?? this.create(),
      end = reader.pos + length;
    while (reader.pos < end) {
      let [fieldNo, wireType] = reader.tag();
      switch (fieldNo) {
        case /* FriendRequest friend_request */ 1:
          message.payload = {
            oneofKind: "friendRequest",
            friendRequest: FriendRequest.internalBinaryRead(
              reader,
              reader.uint32(),
              options,
              message.payload.friendRequest
            ),
          };
          break;
        case /* FriendGameSession friend_game_session */ 2:
          message.payload = {
            oneofKind: "friendGameSession",
            friendGameSession: FriendGameSession.internalBinaryRead(
              reader,
              reader.uint32(),
              options,
              message.payload.friendGameSession
            ),
          };
          break;
        case /* Notification notification */ 3:
          message.payload = {
            oneofKind: "notification",
            notification: Notification.internalBinaryRead(
              reader,
              reader.uint32(),
              options,
              message.payload.notification
            ),
          };
          break;
        default:
          let u = options.readUnknownField;
          if (u === "throw")
            throw new globalThis.Error(
              `Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`
            );
          let d = reader.skip(wireType);
          if (u !== false)
            (u === true ? UnknownFieldHandler.onRead : u)(
              this.typeName,
              message,
              fieldNo,
              wireType,
              d
            );
      }
    }
    return message;
  }
  internalBinaryWrite(message, writer, options) {
    /* FriendRequest friend_request = 1; */
    if (message.payload.oneofKind === "friendRequest")
      FriendRequest.internalBinaryWrite(
        message.payload.friendRequest,
        writer.tag(1, WireType.LengthDelimited).fork(),
        options
      ).join();
    /* FriendGameSession friend_game_session = 2; */
    if (message.payload.oneofKind === "friendGameSession")
      FriendGameSession.internalBinaryWrite(
        message.payload.friendGameSession,
        writer.tag(2, WireType.LengthDelimited).fork(),
        options
      ).join();
    /* Notification notification = 3; */
    if (message.payload.oneofKind === "notification")
      Notification.internalBinaryWrite(
        message.payload.notification,
        writer.tag(3, WireType.LengthDelimited).fork(),
        options
      ).join();
    let u = options.writeUnknownFields;
    if (u !== false)
      (u == true ? UnknownFieldHandler.onWrite : u)(
        this.typeName,
        message,
        writer
      );
    return writer;
  }
}
/**
 * @generated MessageType for protobuf message Envelope
 */
export const Envelope = new Envelope$Type();
