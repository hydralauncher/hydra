import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
} from "react";
import Peer, { DataConnection, MediaConnection } from "peerjs";

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

interface PartyContextType {
  myId: string;
  hostId: string;
  players: Player[];
  chat: ChatMessage[];
  incomingStreams: MediaStream[];
  myStream: MediaStream | null;
  globalLobbies: LobbyInfo[];
  createParty: (name: string, password?: string) => void;
  joinParty: (hostId: string, name: string, password?: string) => void;
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

const PartyContext = createContext<PartyContextType>({} as PartyContextType);

export const PartyProvider = ({ children }: { children: React.ReactNode }) => {
  const [peer, setPeer] = useState<Peer | null>(null);
  const [myId, setMyId] = useState<string>("");
  const [hostId, setHostId] = useState<string>("");
  const [roomName, setRoomName] = useState<string>("Lobby");
  const [players, setPlayers] = useState<Player[]>([]);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [globalLobbies, setGlobalLobbies] = useState<LobbyInfo[]>([]);

  const [connectionStatus, setConnectionStatus] = useState("Iniciando...");
  const [roomError, setRoomError] = useState<string | null>(null);

  const [myStream, setMyStream] = useState<MediaStream | null>(null);
  const [incomingStreams, setIncomingStreams] = useState<MediaStream[]>([]);
  const [isMuted, setIsMuted] = useState(false);

  const playersRef = useRef<Player[]>([]);
  const connectionsRef = useRef<{ [key: string]: DataConnection }>({});
  const hostConnRef = useRef<DataConnection | null>(null);
  const myNameRef = useRef<string>("Player");
  const passwordRef = useRef<string>("");

  const sanitizeText = (text: string): string => {
    if (!text) return "";
    let clean = text.replace(/<\/?[^>]+(>|$)/g, "");
    if (clean.length > 200) clean = clean.substring(0, 200);
    return clean;
  };

  useEffect(() => {
    const newPeer = new Peer(undefined as unknown as string, {
      debug: 1,
      config: {
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:global.stun.twilio.com:3478" },
        ],
      },
    });

    newPeer.on("open", (id) => {
      console.log("CONECTADO! ID:", id);
      setMyId(id);
      setPeer(newPeer);
      setConnectionStatus("Online");

      // TODO: Implementar lógica do Hydra para ouvir convites
    });

    newPeer.on("disconnected", () => {
      setConnectionStatus("Reconectando...");
      newPeer.reconnect();
    });

    newPeer.on("error", (err) => {
      console.error("Erro de conexão:", err);
      setConnectionStatus(`Erro: ${err.type}`);
    });

    newPeer.on("connection", handleDataConnection);
    newPeer.on("call", handleIncomingCall);

    fetchLobbies();

    // TODO: Implementar lógica do Hydra para atualizar Lobbies em tempo real

    return () => {
      newPeer.destroy();
    };
  }, []);

  useEffect(() => {
    playersRef.current = players;
  }, [players]);

  const fetchLobbies = async () => {
    // TODO: Usar API oficial do HydraLauncher para buscar lobbies
    setGlobalLobbies([]);
  };

  const publishLobby = async (
    name: string,
    hostId: string,
    hasPassword: boolean
  ) => {
    // TODO: Usar API oficial do HydraLauncher para publicar lobby
    console.log("Mock publishLobby:", name, hostId, hasPassword);
  };

  const removeLobby = async (hostId: string) => {
    // TODO: Usar API oficial do HydraLauncher para deletar lobby
    console.log("Mock removeLobby:", hostId);
  };

  const sendInvite = async (friendId: string, myName: string) => {
    if (!myId || !hostId) return;
    // TODO: Usar API oficial do HydraLauncher para enviar notificação
    console.log("Mock sendInvite:", friendId, myName);
  };

  const handleIncomingCall = (call: MediaConnection) => {
    navigator.mediaDevices
      .getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      .then((stream) => {
        call.answer(stream);
        call.on("stream", (remoteStream: MediaStream) =>
          addIncomingStream(remoteStream)
        );
      })
      .catch((err) => {
        console.error("Erro Mic:", err);
        call.answer();
      });
  };

  const addIncomingStream = (stream: MediaStream) => {
    setIncomingStreams((prev) => {
      if (!prev.find((s) => s.id === stream.id)) return [...prev, stream];
      return prev;
    });
  };

  const getMic = async (): Promise<MediaStream | null> => {
    try {
      if (myStream) return myStream;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      setMyStream(stream);
      return stream;
    } catch (err) {
      console.error("Sem microfone:", err);
      return null;
    }
  };

  const toggleMic = () => {
    if (myStream) {
      const audioTrack = myStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  const handleDataConnection = (conn: DataConnection) => {
    conn.on("data", (raw: any) => {
      try {
        if (!raw || typeof raw !== "object") return;
        const data = raw as any;

        if (data.type === "MY_INFO" && myId === hostId) {
          if (passwordRef.current && data.password !== passwordRef.current) {
            conn.send({ type: "ERROR", message: "Senha Incorreta" });
            setTimeout(() => conn.close(), 500);
            return;
          }
          const safeName = sanitizeText(data.name);
          const newPlayer = { id: conn.peer, isHost: false, name: safeName };
          const exists = playersRef.current.find((p) => p.id === conn.peer);
          let newList = playersRef.current;
          if (!exists) {
            newList = [...playersRef.current, newPlayer];
            setPlayers(newList);
          }
          connectionsRef.current[conn.peer] = conn;
          broadcastData(
            { type: "UPDATE_PLAYERS", payload: { list: newList, roomName } },
            connectionsRef.current
          );
          if (myStream && peer) {
            const call = peer.call(conn.peer, myStream);
            call.on("stream", (remoteStream) =>
              addIncomingStream(remoteStream)
            );
          }
        }
        if (data.type === "ERROR") {
          setRoomError(data.message);
          leaveParty();
        }
        if (data.type === "UPDATE_PLAYERS") {
          if (Array.isArray(data.payload?.list)) {
            setPlayers(data.payload.list);
            setRoomName(sanitizeText(data.payload.roomName || "Sala"));
            setRoomError(null);
            const currentHost = data.payload.list.find((p: Player) => p.isHost);
            if (currentHost) setHostId(currentHost.id);
          }
        }
        if (data.type === "CHAT") {
          const safeMsg = sanitizeText(data.payload?.message);
          const safeSender = sanitizeText(data.payload?.sender);
          if (safeMsg.trim().length > 0) {
            setChat((prev) => [
              ...prev,
              { sender: safeSender, message: safeMsg },
            ]);
          }
        }
      } catch (error) {
        console.error("Erro dados:", error);
      }
    });
  };

  const broadcastData = (
    data: any,
    connections: { [key: string]: DataConnection }
  ) => {
    Object.values(connections).forEach((conn) => {
      if (conn.open) conn.send(data);
    });
  };

  const createParty = async (name: string, password?: string) => {
    if (!myId) return;
    await getMic();
    setHostId(myId);
    const safeName = sanitizeText(name);
    setRoomName(safeName);
    setPlayers([{ id: myId, isHost: true, name: "Eu (Host)" }]);
    passwordRef.current = password || "";
    publishLobby(safeName, myId, !!password);
  };

  const joinParty = async (
    targetHostId: string,
    myName: string,
    password?: string
  ) => {
    if (!peer) return;
    setRoomError(null);
    myNameRef.current = sanitizeText(myName);
    const stream = await getMic();
    const conn = peer.connect(targetHostId);
    hostConnRef.current = conn;

    conn.on("open", () => {
      setHostId(targetHostId);
      conn.send({
        type: "MY_INFO",
        name: myNameRef.current,
        password: password || "",
      });
      if (stream) {
        const call = peer.call(targetHostId, stream);
        call.on("stream", (remoteStream) => addIncomingStream(remoteStream));
      }
    });

    conn.on("error", (err) => {
      console.error("Erro conexao:", err);
      setConnectionStatus("Erro ao conectar");
    });
    conn.on("close", () => setHostId(""));
    conn.on("data", (raw: any) => {
      if (raw?.type === "ERROR") {
        setRoomError(raw.message);
        conn.close();
      }
    });
  };

  const leaveParty = () => {
    if (myId === hostId) removeLobby(myId);
    setPlayers([]);
    setChat([]);
    setIncomingStreams([]);
    setRoomError(null);
    passwordRef.current = "";
    if (myStream) {
      myStream.getTracks().forEach((track) => track.stop());
      setMyStream(null);
    }
    hostConnRef.current?.close();
    Object.values(connectionsRef.current).forEach((c) => c.close());
    setHostId("");
  };

  const sendMessage = (msg: string) => {
    const safeMsg = sanitizeText(msg);
    if (!safeMsg) return;
    const payload = { sender: myNameRef.current || "Eu", message: safeMsg };
    setChat((prev) => [...prev, payload]);
    if (myId === hostId) {
      broadcastData({ type: "CHAT", payload }, connectionsRef.current);
    } else {
      hostConnRef.current?.send({ type: "CHAT", payload });
    }
  };

  return (
    <PartyContext.Provider
      value={{
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
        isHost: myId === hostId,
        roomName,
        connectionStatus,
        roomError,
      }}
    >
      {children}
    </PartyContext.Provider>
  );
};

export const useParty = () => useContext(PartyContext);