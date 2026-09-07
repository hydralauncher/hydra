import { useState, useEffect, useRef } from "react";
import { useParty } from "../../context/PartyContext";
import { useUserDetails, useAppSelector } from "@renderer/hooks";
import {
  UsersThree,
  Microphone,
  MicrophoneSlash,
  SignOut,
  Plus,
  Link as LinkIcon,
  WifiHigh,
  WifiSlash,
  SpeakerHigh,
  SpeakerSlash,
  WarningCircle,
  Lock,
  LockKey,
  GameController,
  PaperPlaneRight,
  X,
} from "@phosphor-icons/react";
import { Avatar } from "@renderer/components";

const AudioPlayer = ({ stream }: { stream: MediaStream }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (audioRef.current) audioRef.current.srcObject = stream;
  }, [stream]);
  return <audio ref={audioRef} autoPlay />;
};

export default function PartyPage() {
  const {
    myId,
    players,
    createParty,
    joinParty,
    leaveParty,
    chat,
    sendMessage,
    incomingStreams,
    toggleMic,
    isMuted,
    roomName,
    connectionStatus,
    getMic,
    roomError,
    globalLobbies,
    sendInvite,
    isHost,
    hostId,
  } = useParty();

  const { userDetails } = useUserDetails();

  const fullState = useAppSelector((state: any) => state);

  const myFriends =
    fullState?.userDetails?.userDetails?.friends ||
    fullState?.userDetails?.friends ||
    (userDetails as any)?.friends ||
    [];

  useEffect(() => {
    console.log("Party Debug - Estado Completo:", fullState);
    console.log("Party Debug - Amigos Encontrados:", myFriends);
  }, [fullState, myFriends]);

  const myNick =
    userDetails?.displayName || `Player ${Math.floor(Math.random() * 999)}`;

  const [view, setView] = useState<"lobby" | "create" | "join">("lobby");
  const [inputHostId, setInputHostId] = useState("");
  const [msgInput, setMsgInput] = useState("");
  const [newRoomName, setNewRoomName] = useState("Sala do Hydra");
  const [roomPassword, setRoomPassword] = useState("");
  const [inputPassword, setInputPassword] = useState("");

  const [showInviteModal, setShowInviteModal] = useState(false);

  const [isMicTestActive, setIsMicTestActive] = useState(false);
  const micTestRef = useRef<HTMLAudioElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat]);

  const handleJoinFromList = (lobby: any) => {
    setInputHostId(lobby.host_id);
    if (lobby.is_private) {
      setView("join");
      alert("Esta sala tem senha! Digite a senha para entrar.");
    } else {
      joinParty(lobby.host_id, myNick, "");
    }
  };

  const handleSendInvite = async (friendId: string) => {
    await sendInvite(friendId, myNick);
    alert("Convite enviado!");
  };

  const getStatusColor = () => {
    if (connectionStatus === "Online") return "#4caf50";
    if (
      connectionStatus.includes("Reconectando") ||
      connectionStatus.includes("Iniciando")
    )
      return "#ffeb3b";
    return "#f44336";
  };

  const getStatusIcon = () => {
    if (connectionStatus === "Online") return <WifiHigh weight="bold" />;
    if (connectionStatus.includes("Reconectando"))
      return <WarningCircle weight="bold" />;
    return <WifiSlash weight="bold" />;
  };

  const handleTestMic = async () => {
    if (isMicTestActive) {
      setIsMicTestActive(false);
      if (micTestRef.current) micTestRef.current.srcObject = null;
    } else {
      const stream = await getMic();
      if (stream && micTestRef.current) {
        micTestRef.current.srcObject = stream;
        setIsMicTestActive(true);
      }
    }
  };

  useEffect(() => {
    if (players.length > 0) setIsMicTestActive(false);
  }, [players]);

  const glassCardStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: "600px",
    background: "rgba(0, 0, 0, 0.6)",
    backdropFilter: "blur(20px)",
    borderRadius: "16px",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    padding: "30px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
    animation: "fadeIn 0.3s ease-in-out",
    zIndex: 10,
    maxHeight: "80vh",
  };

  if (players.length > 0) {
    return (
      <div
        style={{
          padding: "20px",
          color: "white",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          position: "relative",
        }}
      >
        {incomingStreams.map((s, i) => (
          <AudioPlayer key={i} stream={s} />
        ))}

        {/* MODAL DE CONVITE */}
        {showInviteModal && (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: "rgba(0,0,0,0.8)",
              zIndex: 100,
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <div
              style={{
                width: "400px",
                background: "#1c1c1c",
                border: "1px solid #333",
                borderRadius: "12px",
                padding: "20px",
                boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "20px",
                }}
              >
                <h3 style={{ margin: 0 }}>Convidar Amigos</h3>
                <button
                  onClick={() => setShowInviteModal(false)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "white",
                    cursor: "pointer",
                  }}
                >
                  <X size={20} />
                </button>
              </div>

              <div
                style={{
                  maxHeight: "300px",
                  overflowY: "auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                }}
              >
                {myFriends.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "20px" }}>
                    <p style={{ color: "#888" }}>Lista de amigos vazia.</p>
                    <small style={{ color: "#555" }}>
                      Seus amigos da Steam/Epic devem aparecer aqui
                      automaticamente.
                    </small>
                  </div>
                ) : (
                  myFriends.map((friend: any) => (
                    <div
                      key={friend.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        background: "rgba(255,255,255,0.05)",
                        padding: "10px",
                        borderRadius: "8px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                        }}
                      >
                        <Avatar
                          src={friend.profileImageUrl}
                          alt={friend.displayName}
                          size={32}
                        />
                        {/* Tenta displayName, se não tiver usa username */}
                        <span>
                          {friend.displayName ||
                            friend.username ||
                            "Amigo sem nome"}
                        </span>
                      </div>
                      <button
                        onClick={() => handleSendInvite(friend.id)}
                        style={{
                          background: "#0066cc",
                          border: "none",
                          color: "white",
                          padding: "6px 12px",
                          borderRadius: "6px",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: "5px",
                          fontSize: "12px",
                        }}
                      >
                        <PaperPlaneRight size={14} /> Enviar
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "15px",
            background: "rgba(0, 0, 0, 0.5)",
            backdropFilter: "blur(10px)",
            padding: "10px 20px",
            borderRadius: "12px",
            border: "1px solid rgba(255,255,255,0.1)",
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: "16px" }}>{roomName}</h2>
            <span style={{ fontSize: "11px", color: "#ccc" }}>
              ID: {hostId ? hostId.substring(0, 8) : "..."}...
            </span>
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            {isHost && (
              <button
                onClick={() => setShowInviteModal(true)}
                style={{
                  background: "#00cc66",
                  border: "none",
                  color: "white",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  fontWeight: "bold",
                  fontSize: "12px",
                }}
              >
                <Plus size={16} weight="bold" /> Convidar
              </button>
            )}
            <button
              onClick={() => navigator.clipboard.writeText(hostId)}
              style={{
                background: "rgba(255,255,255,0.1)",
                border: "none",
                color: "white",
                padding: "8px",
                borderRadius: "6px",
                cursor: "pointer",
              }}
              title="Copiar Link"
            >
              <LinkIcon size={18} />
            </button>
            <button
              onClick={toggleMic}
              style={{
                background: isMuted ? "#cc0000" : "rgba(255,255,255,0.1)",
                border: "none",
                color: "white",
                padding: "8px",
                borderRadius: "6px",
                cursor: "pointer",
              }}
            >
              {isMuted ? (
                <MicrophoneSlash size={18} />
              ) : (
                <Microphone size={18} />
              )}
            </button>
            <button
              onClick={leaveParty}
              style={{
                background: "#cc0000",
                border: "none",
                color: "white",
                padding: "8px",
                borderRadius: "6px",
                cursor: "pointer",
              }}
              title="Sair"
            >
              <SignOut size={18} />
            </button>
          </div>
        </div>

        <div
          style={{ display: "flex", gap: "15px", flex: 1, overflow: "hidden" }}
        >
          <div
            style={{
              width: "220px",
              background: "rgba(0,0,0,0.4)",
              borderRadius: "12px",
              padding: "15px",
              overflowY: "auto",
            }}
          >
            <h4
              style={{
                marginTop: 0,
                color: "#aaa",
                fontSize: "11px",
                textTransform: "uppercase",
              }}
            >
              Jogadores ({players.length})
            </h4>
            {players.map((p) => (
              <div
                key={p.id}
                style={{
                  padding: "8px",
                  background: "rgba(255,255,255,0.05)",
                  marginBottom: "4px",
                  borderRadius: "6px",
                  borderLeft: p.isHost
                    ? "3px solid #00FF00"
                    : "3px solid transparent",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "13px",
                }}
              >
                <div
                  style={{
                    width: "6px",
                    height: "6px",
                    borderRadius: "50%",
                    background: "#00FF00",
                  }}
                ></div>
                {p.name} {p.id === myId && "(Você)"}
              </div>
            ))}
          </div>
          <div
            style={{
              flex: 1,
              background: "rgba(0,0,0,0.4)",
              borderRadius: "12px",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ flex: 1, padding: "15px", overflowY: "auto" }}>
              {chat.map((c, i) => (
                <div
                  key={i}
                  style={{
                    marginBottom: "8px",
                    textAlign:
                      c.sender === myNick || c.sender === "Eu"
                        ? "right"
                        : "left",
                  }}
                >
                  <span
                    style={{
                      background:
                        c.sender === myNick || c.sender === "Eu"
                          ? "#0066cc"
                          : "rgba(255,255,255,0.1)",
                      padding: "6px 12px",
                      borderRadius: "12px",
                      display: "inline-block",
                      fontSize: "13px",
                    }}
                  >
                    <strong>{c.sender}: </strong>
                    {c.message}
                  </span>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <div style={{ padding: "10px" }}>
              <input
                value={msgInput}
                onChange={(e) => setMsgInput(e.target.value)}
                onKeyDown={(e) =>
                  e.key === "Enter" && (sendMessage(msgInput), setMsgInput(""))
                }
                placeholder="Enviar mensagem..."
                style={{
                  width: "100%",
                  padding: "10px",
                  borderRadius: "8px",
                  border: "none",
                  background: "rgba(255,255,255,0.1)",
                  color: "white",
                }}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "30px",
          left: "40px",
          right: "40px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          zIndex: 20,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
          }}
        >
          <h1
            style={{
              margin: 0,
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontSize: "24px",
              color: "white",
              textShadow: `0 0 15px ${getStatusColor()}80`,
            }}
          >
            <UsersThree color={getStatusColor()} weight="fill" /> Hydra Party
          </h1>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "11px",
              marginTop: "6px",
              color: getStatusColor(),
              border: `1px solid ${getStatusColor()}`,
              padding: "4px 10px",
              borderRadius: "12px",
              background: "rgba(0,0,0,0.4)",
              boxShadow: `0 0 10px ${getStatusColor()}30`,
            }}
          >
            {getStatusIcon()}{" "}
            <span
              style={{
                fontWeight: 600,
                letterSpacing: "0.5px",
                textTransform: "uppercase",
              }}
            >
              {connectionStatus}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <button
            onClick={handleTestMic}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 12px",
              background: isMicTestActive
                ? "#ff9800"
                : "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "white",
              borderRadius: "6px",
              cursor: "pointer",
              transition: "0.2s",
              fontSize: "12px",
            }}
          >
            {isMicTestActive ? (
              <SpeakerHigh size={16} />
            ) : (
              <SpeakerSlash size={16} />
            )}{" "}
            {isMicTestActive ? "Parar" : "Testar Mic"}
          </button>
          <audio ref={micTestRef} autoPlay muted={false} />
          <button
            onClick={() => setView("create")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 16px",
              background: "rgba(255,255,255,0.1)",
              border: "1px solid rgba(255,255,255,0.2)",
              color: "white",
              borderRadius: "6px",
              cursor: "pointer",
              backdropFilter: "blur(5px)",
              fontSize: "12px",
              fontWeight: 600,
            }}
          >
            <Plus size={16} weight="bold" /> Criar Sala
          </button>
          <button
            onClick={() => setView("join")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 16px",
              background: "#0066cc",
              border: "none",
              color: "white",
              borderRadius: "6px",
              cursor: "pointer",
              boxShadow: "0 4px 15px rgba(0,102,204,0.4)",
              fontSize: "12px",
              fontWeight: 600,
            }}
          >
            <LinkIcon size={16} weight="bold" /> Entrar com ID
          </button>
        </div>
      </div>

      <div
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        {roomError && (
          <div
            style={{
              position: "absolute",
              top: "100px",
              background: "#f44336",
              padding: "10px 20px",
              borderRadius: "8px",
              color: "white",
              zIndex: 50,
              fontWeight: "bold",
            }}
          >
            ⚠️ {roomError}
          </div>
        )}

        {view === "create" && (
          <div style={glassCardStyle}>
            <h2 style={{ marginBottom: "20px", fontSize: "20px" }}>
              Criar Nova Sala
            </h2>
            <input
              value={newRoomName}
              onChange={(e) => setNewRoomName(e.target.value)}
              placeholder="Nome da Sala"
              style={{
                width: "100%",
                padding: "12px",
                borderRadius: "8px",
                border: "1px solid rgba(255,255,255,0.2)",
                background: "rgba(0,0,0,0.3)",
                color: "white",
                marginBottom: "10px",
                fontSize: "14px",
                outline: "none",
              }}
            />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                width: "100%",
                marginBottom: "20px",
              }}
            >
              <Lock size={24} color="#aaa" />
              <input
                value={roomPassword}
                onChange={(e) => setRoomPassword(e.target.value)}
                placeholder="Senha (Opcional)"
                type="password"
                style={{
                  flex: 1,
                  padding: "12px",
                  borderRadius: "8px",
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: "rgba(0,0,0,0.3)",
                  color: "white",
                  fontSize: "14px",
                  outline: "none",
                }}
              />
            </div>
            <div style={{ display: "flex", gap: "10px", width: "100%" }}>
              <button
                onClick={() => setView("lobby")}
                style={{
                  flex: 1,
                  padding: "12px",
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,0.2)",
                  color: "#aaa",
                  borderRadius: "8px",
                  cursor: "pointer",
                }}
              >
                Cancelar
              </button>
              <button
                disabled={!myId}
                onClick={() => createParty(newRoomName, roomPassword)}
                style={{
                  flex: 1,
                  padding: "12px",
                  background: myId ? "#00cc66" : "#444",
                  border: "none",
                  color: "white",
                  borderRadius: "8px",
                  cursor: "pointer",
                  fontWeight: "bold",
                }}
              >
                {myId ? "Iniciar" : "Sem Rede"}
              </button>
            </div>
          </div>
        )}
        {view === "join" && (
          <div style={glassCardStyle}>
            <h2 style={{ marginBottom: "20px", fontSize: "20px" }}>
              Entrar em Sala
            </h2>
            <input
              value={inputHostId}
              onChange={(e) => setInputHostId(e.target.value)}
              placeholder="Cole o ID da Sala..."
              style={{
                width: "100%",
                padding: "12px",
                borderRadius: "8px",
                border: "1px solid rgba(255,255,255,0.2)",
                background: "rgba(0,0,0,0.3)",
                color: "white",
                marginBottom: "10px",
                fontSize: "14px",
                outline: "none",
              }}
            />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                width: "100%",
                marginBottom: "20px",
              }}
            >
              <LockKey size={24} color="#aaa" />
              <input
                value={inputPassword}
                onChange={(e) => setInputPassword(e.target.value)}
                placeholder="Senha da Sala (Se houver)"
                type="password"
                style={{
                  flex: 1,
                  padding: "12px",
                  borderRadius: "8px",
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: "rgba(0,0,0,0.3)",
                  color: "white",
                  fontSize: "14px",
                  outline: "none",
                }}
              />
            </div>
            <div style={{ display: "flex", gap: "10px", width: "100%" }}>
              <button
                onClick={() => setView("lobby")}
                style={{
                  flex: 1,
                  padding: "12px",
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,0.2)",
                  color: "#aaa",
                  borderRadius: "8px",
                  cursor: "pointer",
                }}
              >
                Cancelar
              </button>
              <button
                disabled={!myId}
                onClick={() => joinParty(inputHostId, myNick, inputPassword)}
                style={{
                  flex: 1,
                  padding: "12px",
                  background: myId ? "#00cc66" : "#444",
                  border: "none",
                  color: "white",
                  borderRadius: "8px",
                  cursor: "pointer",
                  fontWeight: "bold",
                }}
              >
                Conectar
              </button>
            </div>
          </div>
        )}

        {view === "lobby" && (
          <div style={glassCardStyle}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                marginBottom: "20px",
              }}
            >
              <UsersThree size={32} color="#00FF00" />
              <h3 style={{ margin: 0, fontSize: "22px" }}>Salas Públicas</h3>
            </div>

            <div
              style={{
                width: "100%",
                maxHeight: "300px",
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
                paddingRight: "5px",
              }}
            >
              {globalLobbies.length === 0 && (
                <div
                  style={{
                    textAlign: "center",
                    padding: "20px",
                    color: "#888",
                  }}
                >
                  <GameController
                    size={40}
                    style={{ opacity: 0.3, marginBottom: "10px" }}
                  />
                  <p>Nenhuma sala aberta no momento.</p>
                  <p style={{ fontSize: "12px" }}>Seja o primeiro a criar!</p>
                </div>
              )}

              {globalLobbies.map((lobby) => (
                <div
                  key={lobby.id}
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    borderRadius: "8px",
                    padding: "15px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    border: "1px solid rgba(255,255,255,0.1)",
                    transition: "0.2s",
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span
                      style={{
                        fontWeight: "bold",
                        fontSize: "16px",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                      }}
                    >
                      {lobby.room_name}{" "}
                      {lobby.is_private && (
                        <LockKey size={14} color="#ff9800" />
                      )}
                    </span>
                    <span style={{ fontSize: "11px", color: "#888" }}>
                      Host: {lobby.host_id.substring(0, 6)}...
                    </span>
                  </div>
                  <button
                    onClick={() => handleJoinFromList(lobby)}
                    style={{
                      background: lobby.is_private ? "#ff9800" : "#00cc66",
                      color: "white",
                      border: "none",
                      padding: "8px 16px",
                      borderRadius: "6px",
                      cursor: "pointer",
                      fontWeight: "bold",
                      fontSize: "12px",
                    }}
                  >
                    {lobby.is_private ? "Entrar (Senha)" : "Entrar"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
