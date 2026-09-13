import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Peer, { DataConnection, MediaConnection } from "peerjs";

const MAX_TEXT_LENGTH = 200;
const ERROR_CLOSE_DELAY_MS = 500;
const DEFAULT_ROOM_NAME = "Lobby";
const DEFAULT_PLAYER_NAME = "Player";

export interface Player {
  id: string;
  isHost: boolean;
  name: string;
}

export interface LobbyInfo {
  id: number;
  room_name: string;
  host_id: string;
  is_private: boolean;
  created_at: string;
}

interface ChatMessage {
  sender: string;
  message: string;
}

type PartyMessage =
  | {
    type: "MY_INFO";
    name: string;
    password: string;
  }
  | {
    type: "ERROR";
    message: string;
  }
  | {
    type: "UPDATE_PLAYERS";
    payload: {
      list: Player[];
      roomName: string;
    };
  }
  | {
    type: "CHAT";
    payload: ChatMessage;
  };

interface PartyContextType {
  myId: string;
  hostId: string;
  players: Player[];
  chat: ChatMessage[];
  incomingStreams: MediaStream[];
  myStream: MediaStream | null;
  globalLobbies: LobbyInfo[];
  createParty: (name: string, password?: string) => Promise<void>;
  joinParty: (
    hostId: string,
    name: string,
    password?: string
  ) => Promise<void>;
  leaveParty: () => void;
  sendMessage: (msg: string) => void;
  sendInvite: (friendId: string, myName: string) => Promise<void>;
  toggleMic: () => void;
  getMic: () => Promise<MediaStream | null>;
  isMuted: boolean;
  isHost: boolean;
  roomName: string;
  connectionStatus: string;
  roomError: string | null;
}

const PartyContext = createContext<PartyContextType | null>(null);

const sanitizeText = (text: string): string => {
  return text.trim().slice(0, MAX_TEXT_LENGTH);
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const isPlayer = (value: unknown): value is Player => {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === "string" &&
    typeof value.isHost === "boolean" &&
    typeof value.name === "string"
  );
};

const isPartyMessage = (value: unknown): value is PartyMessage => {
  if (!isRecord(value) || typeof value.type !== "string") return false;

  switch (value.type) {
    case "MY_INFO":
      return (
        typeof value.name === "string" &&
        typeof value.password === "string"
      );

    case "ERROR":
      return typeof value.message === "string";

    case "UPDATE_PLAYERS":
      return (
        isRecord(value.payload) &&
        Array.isArray(value.payload.list) &&
        value.payload.list.every(isPlayer) &&
        typeof value.payload.roomName === "string"
      );

    case "CHAT":
      return (
        isRecord(value.payload) &&
        typeof value.payload.sender === "string" &&
        typeof value.payload.message === "string"
      );

    default:
      return false;
  }
};

const createMicrophoneStream = (): Promise<MediaStream> =>
  navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

export const PartyProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [myId, setMyId] = useState("");
  const [hostId, setHostId] = useState("");
  const [roomName, setRoomName] = useState(DEFAULT_ROOM_NAME);
  const [players, setPlayers] = useState<Player[]>([]);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [globalLobbies, setGlobalLobbies] = useState<LobbyInfo[]>([]);
  const [connectionStatus, setConnectionStatus] = useState("Iniciando...");
  const [roomError, setRoomError] = useState<string | null>(null);
  const [myStream, setMyStream] = useState<MediaStream | null>(null);
  const [incomingStreams, setIncomingStreams] = useState<MediaStream[]>([]);
  const [isMuted, setIsMuted] = useState(false);

  const peerRef = useRef<Peer | null>(null);
  const myIdRef = useRef("");
  const hostIdRef = useRef("");
  const playersRef = useRef<Player[]>([]);
  const roomNameRef = useRef(DEFAULT_ROOM_NAME);
  const myStreamRef = useRef<MediaStream | null>(null);

  const connectionsRef = useRef<Record<string, DataConnection>>({});
  const activeCallsRef = useRef<MediaConnection[]>([]);
  const hostConnRef = useRef<DataConnection | null>(null);

  const myNameRef = useRef(DEFAULT_PLAYER_NAME);
  const passwordRef = useRef("");

  const micRequestRef = useRef<Promise<MediaStream | null> | null>(null);

  const updateMyId = useCallback((id: string) => {
    myIdRef.current = id;
    setMyId(id);
  }, []);

  const updateHostId = useCallback((id: string) => {
    hostIdRef.current = id;
    setHostId(id);
  }, []);

  const updatePlayers = useCallback((nextPlayers: Player[]) => {
    playersRef.current = nextPlayers;
    setPlayers(nextPlayers);
  }, []);

  const updateRoomName = useCallback((name: string) => {
    roomNameRef.current = name;
    setRoomName(name);
  }, []);

  const addIncomingStream = useCallback((stream: MediaStream) => {
    setIncomingStreams((currentStreams) => {
      if (
        currentStreams.some(
          (currentStream) => currentStream.id === stream.id
        )
      ) {
        return currentStreams;
      }

      return [...currentStreams, stream];
    });
  }, []);

  const getMic = useCallback(async (): Promise<MediaStream | null> => {
    if (myStreamRef.current) {
      return myStreamRef.current;
    }

    if (micRequestRef.current) {
      return micRequestRef.current;
    }

    const request = createMicrophoneStream()
      .then((stream) => {
        myStreamRef.current = stream;
        setMyStream(stream);

        return stream;
      })
      .catch((error: unknown) => {
        console.error("Não foi possível acessar o microfone:", error);
        return null;
      })
      .finally(() => {
        micRequestRef.current = null;
      });

    micRequestRef.current = request;

    return request;
  }, []);

  const isCurrentHost = useCallback(() => {
    return (
      myIdRef.current !== "" &&
      myIdRef.current === hostIdRef.current
    );
  }, []);

  const broadcastData = useCallback(
    (
      data: PartyMessage,
      connections: Record<string, DataConnection>
    ) => {
      Object.values(connections).forEach((connection) => {
        if (connection.open) {
          connection.send(data);
        }
      });
    },
    []
  );

  const fetchLobbies = useCallback(() => {
    setGlobalLobbies([]);
  }, []);

  const publishLobby = useCallback(
    (
      _name: string,
      _hostId: string,
      _hasPassword: boolean
    ): Promise<void> => Promise.resolve(),
    []
  );

  const removeLobby = useCallback(
    (_hostId: string): Promise<void> => Promise.resolve(),
    []
  );

  const sendInvite = useCallback(
    (_friendId: string, _myName: string): Promise<void> =>
      Promise.resolve(),
    []
  );

  const leaveParty = useCallback(() => {
    const wasHost = isCurrentHost();

    if (wasHost && myIdRef.current) {
      void removeLobby(myIdRef.current);
    }

    activeCallsRef.current.forEach((call) => {
      call.close();
    });

    activeCallsRef.current = [];

    hostConnRef.current?.close();
    hostConnRef.current = null;

    Object.values(connectionsRef.current).forEach((connection) => {
      connection.close();
    });

    connectionsRef.current = {};

    const stream = myStreamRef.current;

    if (stream) {
      stream.getTracks().forEach((track) => {
        track.stop();
      });

      myStreamRef.current = null;
      setMyStream(null);
    }

    playersRef.current = [];
    setPlayers([]);
    setChat([]);
    setIncomingStreams([]);
    setRoomError(null);

    passwordRef.current = "";

    updateHostId("");
  }, [isCurrentHost, removeLobby, updateHostId]);

  const handleIncomingCall = useCallback(
    (call: MediaConnection) => {
      const isPlayerInRoom = playersRef.current.some(
        (player) => player.id === call.peer
      );

      if (!isPlayerInRoom) {
        call.close();
        return;
      }

      activeCallsRef.current.push(call);

      call.on("stream", addIncomingStream);

      void getMic().then((stream) => {
        if (stream) {
          call.answer(stream);
        } else {
          call.answer();
        }
      });
    },
    [addIncomingStream, getMic]
  );

  const handleChatMessage = useCallback(
    (
      connection: DataConnection,
      message: ChatMessage
    ) => {
      const safeMessage = sanitizeText(message.message);
      const safeSender = sanitizeText(message.sender);

      if (!safeMessage) {
        return;
      }

      const newMessage: ChatMessage = {
        sender: safeSender,
        message: safeMessage,
      };

      setChat((currentChat) => [...currentChat, newMessage]);

      if (isCurrentHost()) {
        const otherConnections = {
          ...connectionsRef.current,
        };

        delete otherConnections[connection.peer];

        broadcastData(
          {
            type: "CHAT",
            payload: newMessage,
          },
          otherConnections
        );
      }
    },
    [broadcastData, isCurrentHost]
  );

  const handlePartyMessage = useCallback(
    (
      connection: DataConnection,
      message: PartyMessage
    ) => {
      switch (message.type) {
        case "MY_INFO": {
          if (!isCurrentHost()) {
            return;
          }

          if (
            passwordRef.current &&
            message.password !== passwordRef.current
          ) {
            connection.send({
              type: "ERROR",
              message: "Senha Incorreta",
            });

            window.setTimeout(() => {
              connection.close();
            }, ERROR_CLOSE_DELAY_MS);

            return;
          }

          const safeName = sanitizeText(message.name);

          const newPlayer: Player = {
            id: connection.peer,
            isHost: false,
            name: safeName || DEFAULT_PLAYER_NAME,
          };

          const playerExists = playersRef.current.some(
            (player) => player.id === connection.peer
          );

          const nextPlayers = playerExists
            ? playersRef.current
            : [...playersRef.current, newPlayer];

          if (!playerExists) {
            updatePlayers(nextPlayers);
          }

          connectionsRef.current[connection.peer] = connection;

          broadcastData(
            {
              type: "UPDATE_PLAYERS",
              payload: {
                list: nextPlayers,
                roomName: roomNameRef.current,
              },
            },
            connectionsRef.current
          );

          const stream = myStreamRef.current;
          const currentPeer = peerRef.current;

          if (stream && currentPeer) {
            const call = currentPeer.call(
              connection.peer,
              stream
            );

            activeCallsRef.current.push(call);

            call.on("stream", addIncomingStream);
          }

          return;
        }

        case "ERROR": {
          const errorMessage = sanitizeText(message.message);

          leaveParty();
          setRoomError(errorMessage);

          return;
        }

        case "UPDATE_PLAYERS": {
          const nextPlayers = message.payload.list;

          updatePlayers(nextPlayers);

          updateRoomName(
            sanitizeText(message.payload.roomName) ||
            DEFAULT_ROOM_NAME
          );

          setRoomError(null);

          const currentHost = nextPlayers.find(
            (player) => player.isHost
          );

          updateHostId(currentHost?.id ?? "");

          return;
        }

        case "CHAT":
          handleChatMessage(connection, message.payload);
          return;
      }
    },
    [
      addIncomingStream,
      broadcastData,
      handleChatMessage,
      isCurrentHost,
      leaveParty,
      updateHostId,
      updatePlayers,
      updateRoomName,
    ]
  );

  const handleDataConnection = useCallback(
    (connection: DataConnection) => {
      connection.on("data", (raw: unknown) => {
        if (!isPartyMessage(raw)) {
          return;
        }

        try {
          handlePartyMessage(connection, raw);
        } catch (error: unknown) {
          console.error(
            "Erro ao processar dados da Party:",
            error
          );
        }
      });

      connection.on("close", () => {
        if (!isCurrentHost()) {
          return;
        }

        const nextPlayers = playersRef.current.filter(
          (player) => player.id !== connection.peer
        );

        delete connectionsRef.current[connection.peer];

        updatePlayers(nextPlayers);

        broadcastData(
          {
            type: "UPDATE_PLAYERS",
            payload: {
              list: nextPlayers,
              roomName: roomNameRef.current,
            },
          },
          connectionsRef.current
        );
      });
    },
    [
      broadcastData,
      handlePartyMessage,
      isCurrentHost,
      updatePlayers,
    ]
  );

  const connectVoiceCall = useCallback(
    (targetPeerId: string, stream: MediaStream) => {
      const currentPeer = peerRef.current;

      if (!currentPeer) {
        return;
      }

      const call = currentPeer.call(
        targetPeerId,
        stream
      );

      activeCallsRef.current.push(call);

      call.on("stream", addIncomingStream);
    },
    [addIncomingStream]
  );

  const createParty = useCallback(
    async (
      name: string,
      password?: string
    ): Promise<void> => {
      if (!myIdRef.current) {
        return;
      }

      const stream = await getMic();

      const safeName =
        sanitizeText(name) || DEFAULT_ROOM_NAME;

      const safePassword = password?.trim() ?? "";

      passwordRef.current = safePassword;

      updateHostId(myIdRef.current);
      updateRoomName(safeName);

      updatePlayers([
        {
          id: myIdRef.current,
          isHost: true,
          name: "Eu (Host)",
        },
      ]);

      await publishLobby(
        safeName,
        myIdRef.current,
        Boolean(safePassword)
      );

      if (stream) {
        myStreamRef.current = stream;
      }
    },
    [
      getMic,
      publishLobby,
      updateHostId,
      updatePlayers,
      updateRoomName,
    ]
  );

  const joinParty = useCallback(
    async (
      targetHostId: string,
      myName: string,
      password?: string
    ): Promise<void> => {
      const currentPeer = peerRef.current;
      const safeHostId = targetHostId.trim();

      if (!currentPeer || !safeHostId) {
        return;
      }

      setRoomError(null);

      myNameRef.current =
        sanitizeText(myName) || DEFAULT_PLAYER_NAME;

      const stream = await getMic();

      const connection = currentPeer.connect(safeHostId);

      hostConnRef.current = connection;

      connection.on("open", () => {
        updateHostId(safeHostId);

        connection.send({
          type: "MY_INFO",
          name: myNameRef.current,
          password: password?.trim() ?? "",
        });

        if (stream) {
          connectVoiceCall(safeHostId, stream);
        }
      });

      connection.on("error", () => {
        setConnectionStatus("Erro ao conectar");
      });

      connection.on("close", () => {
        if (hostConnRef.current === connection) {
          hostConnRef.current = null;
        }

        updateHostId("");
      });

      connection.on("data", (raw: unknown) => {
        if (!isPartyMessage(raw)) {
          return;
        }

        if (raw.type === "ERROR") {
          setRoomError(sanitizeText(raw.message));
          connection.close();
        }
      });
    },
    [connectVoiceCall, getMic, updateHostId]
  );

  const sendMessage = useCallback(
    (message: string) => {
      const safeMessage = sanitizeText(message);

      if (!safeMessage) {
        return;
      }

      const payload: ChatMessage = {
        sender:
          sanitizeText(myNameRef.current) || "Eu",
        message: safeMessage,
      };

      setChat((currentChat) => [
        ...currentChat,
        payload,
      ]);

      if (isCurrentHost()) {
        broadcastData(
          {
            type: "CHAT",
            payload,
          },
          connectionsRef.current
        );

        return;
      }

      const hostConnection = hostConnRef.current;

      if (hostConnection?.open) {
        hostConnection.send({
          type: "CHAT",
          payload,
        });
      }
    },
    [broadcastData, isCurrentHost]
  );

  const toggleMic = useCallback(() => {
    const audioTrack =
      myStreamRef.current?.getAudioTracks()[0];

    if (!audioTrack) {
      return;
    }

    audioTrack.enabled = !audioTrack.enabled;

    setIsMuted(!audioTrack.enabled);
  }, []);

  useEffect(() => {
    const newPeer = new Peer({
      debug: 1,
      config: {
        iceServers: [
          {
            urls: "stun:stun.l.google.com:19302",
          },
          {
            urls: "stun:global.stun.twilio.com:3478",
          },
        ],
      },
    });

    peerRef.current = newPeer;

    newPeer.on("open", (id) => {
      updateMyId(id);
      setConnectionStatus("Online");
    });

    newPeer.on("disconnected", () => {
      setConnectionStatus("Reconectando...");
      newPeer.reconnect();
    });

    newPeer.on("error", (error) => {
      setConnectionStatus(`Erro: ${error.type}`);
    });

    newPeer.on("connection", handleDataConnection);
    newPeer.on("call", handleIncomingCall);

    fetchLobbies();

    return () => {
      activeCallsRef.current.forEach((call) => {
        call.close();
      });

      activeCallsRef.current = [];

      newPeer.destroy();

      peerRef.current = null;
    };
  }, [
    fetchLobbies,
    handleDataConnection,
    handleIncomingCall,
    updateMyId,
  ]);

  useEffect(() => {
    hostIdRef.current = hostId;
  }, [hostId]);

  useEffect(() => {
    roomNameRef.current = roomName;
  }, [roomName]);

  useEffect(() => {
    playersRef.current = players;
  }, [players]);

  useEffect(() => {
    myStreamRef.current = myStream;
  }, [myStream]);

  const contextValue = useMemo<PartyContextType>(
    () => ({
      myId,
      hostId,
      players,
      chat,
      incomingStreams,
      myStream,
      globalLobbies,
      createParty,
      joinParty,
      leaveParty,
      sendMessage,
      sendInvite,
      toggleMic,
      getMic,
      isMuted,
      isHost:
        myId !== "" && myId === hostId,
      roomName,
      connectionStatus,
      roomError,
    }),
    [
      myId,
      hostId,
      players,
      chat,
      incomingStreams,
      myStream,
      globalLobbies,
      createParty,
      joinParty,
      leaveParty,
      sendMessage,
      sendInvite,
      toggleMic,
      getMic,
      isMuted,
      roomName,
      connectionStatus,
      roomError,
    ]
  );

  return (
    <PartyContext.Provider value={contextValue}>
      {children}
    </PartyContext.Provider>
  );
};

export const useParty = (): PartyContextType => {
  const context = useContext(PartyContext);

  if (!context) {
    throw new Error(
      "useParty must be used inside a PartyProvider"
    );
  }

  return context;
};