import React, { useState, useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { motion, AnimatePresence } from "motion/react";
import {
  Trophy,
  User,
  Key,
  Flame,
  UserPlus,
  Compass,
  ArrowRight,
  Sparkles,
  RotateCcw,
  PlusCircle,
  Copy,
  CheckCircle,
  LogOut,
  AlertTriangle,
  Coins
} from "lucide-react";
import { User as UserType, GameRoom, GAME_COLORS } from "./types";
import ParkourGameCanvas from "./components/ParkourGameCanvas";

export default function App() {
  // Navigation & authentication state loops
  const [currentUser, setCurrentUser] = useState<UserType | null>(null);
  const [screen, setScreen] = useState<"auth" | "dashboard" | "lobby" | "game">("auth");
  
  // Auth Form State
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  // Room Matchmaking State
  const [joinRoomId, setJoinRoomId] = useState("");
  const [lobbyError, setLobbyError] = useState("");
  const [currentRoom, setCurrentRoom] = useState<GameRoom | null>(null);
  const [copied, setCopied] = useState(false);

  // Real-time sockets elements
  const socketRef = useRef<Socket | null>(null);

  // Racing Victory Overlay State
  const [winnerName, setWinnerName] = useState<string | null>(null);
  const [winnerSocketId, setWinnerSocketId] = useState<string | null>(null);
  const [coinsCelebration, setCoinsCelebration] = useState<Array<{ id: number; left: number; top: number; delay: number }>>([]);

  // Check storage on setup
  useEffect(() => {
    const savedUser = localStorage.getItem("parkour_runner");
    if (savedUser) {
      try {
        const u = JSON.parse(savedUser);
        setCurrentUser(u);
        setScreen("dashboard");
        syncProfile(u.username);
      } catch (err) {
        localStorage.removeItem("parkour_runner");
      }
    }
  }, []);

  // Set up socket links on user login state change
  useEffect(() => {
    if (currentUser) {
      // Connect to unified relative socket.io endpoint
      const socket = io({
        query: { username: currentUser.username }
      });
      socketRef.current = socket;

      // Register identity instantly on server
      socket.emit("join-lobby", { username: currentUser.username });

      // Core packet routing bindings
      socket.on("room-created", ({ roomId, players }) => {
        setCurrentRoom({
          id: roomId,
          players,
          status: "waiting",
          countdownSeconds: 5
        });
        setScreen("lobby");
      });

      socket.on("room-updated", ({ roomId, players, status, leftNotification }) => {
        setCurrentRoom((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            players,
            status: status || "waiting"
          };
        });
        if (leftNotification) {
          // Toast or message notify
          setLobbyError(`${leftNotification} disconnected. Waiting for players...`);
          setTimeout(() => setLobbyError(""), 4000);
          setScreen("lobby");
          setWinnerName(null);
        }
      });

      socket.on("countdown-start", ({ seconds }) => {
        setScreen("game");
        setWinnerName(null);
        setWinnerSocketId(null);
        setCoinsCelebration([]);
        setCurrentRoom((prev) => {
          if (!prev) return null;
          return { ...prev, status: "countdown", countdownSeconds: seconds };
        });
      });

      socket.on("countdown-tick", ({ seconds }) => {
        setCurrentRoom((prev) => {
          if (!prev) return null;
          return { ...prev, countdownSeconds: seconds };
        });
      });

      socket.on("game-start", () => {
        setCurrentRoom((prev) => {
          if (!prev) return null;
          return { ...prev, status: "racing" };
        });
      });

      // Synchronized race completed event broadcasted authoritatively by backend
      socket.on("race-over", ({ winner, winnerSocketId: winSocId, newTokens }) => {
        setWinnerName(winner);
        setWinnerSocketId(winSocId);
        
        setCurrentRoom((prev) => {
          if (!prev) return null;
          return { ...prev, status: "ended" };
        });

        // Trigger dynamic coins visual particle fly-ins
        const list = Array.from({ length: 15 }).map((_, idx) => ({
          id: idx,
          left: 40 + Math.random() * 20, // emergent location percentage
          top: 50 + Math.random() * 20,
          delay: idx * 0.08
        }));
        setCoinsCelebration(list);

        // Update local user parameters if I am the absolute winner
        if (currentUser && winner.toLowerCase().trim() === currentUser.username.toLowerCase().trim()) {
          const updatedUser = { ...currentUser, tokens: newTokens };
          setCurrentUser(updatedUser);
          localStorage.setItem("parkour_runner", JSON.stringify(updatedUser));
        } else {
          // Sync profile to get correct tokens count
          syncProfile(currentUser?.username || "");
        }
      });

      socket.on("error", (msg: string) => {
        setLobbyError(msg);
        setTimeout(() => setLobbyError(""), 5000);
      });

      return () => {
        socket.disconnect();
        socketRef.current = null;
      };
    }
  }, [currentUser]);

  // Sync latest statistics profiles from JSON storage
  const syncProfile = async (uName: string) => {
    try {
      const res = await fetch(`/api/profile/${encodeURIComponent(uName)}`);
      if (res.ok) {
        const data = await res.json();
        setCurrentUser(prev => prev ? { ...prev, tokens: data.tokens } : null);
        
        // Update storage matching the latest DB count
        const cached = localStorage.getItem("parkour_runner");
        if (cached) {
          const userObj = JSON.parse(cached);
          userObj.tokens = data.tokens;
          localStorage.setItem("parkour_runner", JSON.stringify(userObj));
        }
      }
    } catch (err) {
      console.warn("Failed syncing statistics profile:", err);
    }
  };

  // Auth Operations
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    const trimmedUsername = username.trim();
    if (!trimmedUsername || !password.trim()) {
      setAuthError("Please fill out all credentials.");
      return;
    }

    if (trimmedUsername.length < 3 || trimmedUsername.length > 12) {
      setAuthError("Username must be between 3 and 12 characters.");
      return;
    }

    setAuthLoading(true);
    const endpoint = authMode === "login" ? "/api/login" : "/api/register";

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: trimmedUsername, password })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Authentication issue.");
      }

      const validatedUser: UserType = data.user;
      setCurrentUser(validatedUser);
      localStorage.setItem("parkour_runner", JSON.stringify(validatedUser));
      setScreen("dashboard");
      
      // Clean forms
      setUsername("");
      setPassword("");
    } catch (err: any) {
      setAuthError(err.message || "Failed connecting to server.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("parkour_runner");
    setCurrentUser(null);
    setScreen("auth");
  };

  // Room Matchmaking Operations
  const handleCreateRoom = () => {
    if (socketRef.current) {
      setLobbyError("");
      socketRef.current.emit("create-room");
    }
  };

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    setLobbyError("");
    const trimmedId = joinRoomId.toUpperCase().trim();
    if (!trimmedId) {
      setLobbyError("Please enter a valid 4-character Room Code.");
      return;
    }

    if (socketRef.current) {
      socketRef.current.emit("join-room", { roomId: trimmedId });
    }
  };

  const copyRoomCodeToClipboard = () => {
    if (!currentRoom) return;
    navigator.clipboard.writeText(currentRoom.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleLeaveLobby = () => {
    if (socketRef.current) {
      // Refresh connection to cleanly detach from current room channels
      socketRef.current.disconnect();
      socketRef.current.connect();
    }
    setCurrentRoom(null);
    setScreen("dashboard");
  };

  return (
    <div className="min-h-screen bg-[#020617] text-slate-100 flex flex-col justify-between selection:bg-rose-500 selection:text-white font-sans antialiased relative overflow-hidden">
      
      {/* Atmospheric Background Elements */}
      <div className="absolute top-[-100px] left-[-100px] w-[400px] h-[400px] bg-cyan-900/20 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute bottom-[-50px] right-[-50px] w-[500px] h-[500px] bg-fuchsia-900/10 rounded-full blur-[150px] pointer-events-none" />

      {/* Top Header bar with Neon Dash template layout */}
      <header className="h-16 flex items-center justify-between px-4 md:px-8 bg-slate-900/40 border-b border-slate-800/50 backdrop-blur-md z-10 sticky top-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-cyan-400 to-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h1 className="text-md md:text-lg font-black tracking-tighter uppercase italic text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-400 font-display">
            NeonDash PK
          </h1>
        </div>

        <div className="flex items-center gap-2 md:gap-8">
          <div className="hidden md:flex items-center gap-2 bg-slate-950/60 px-4 py-1.5 rounded-full border border-slate-700/50">
            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
            <span className="text-[10px] font-mono text-slate-400 uppercase tracking-widest">Server: Tokyo-01</span>
          </div>

          {currentUser && (
            <div className="flex items-center gap-2 md:gap-4">
              <div className="flex items-center gap-2 bg-slate-950/60 border border-slate-850 px-3 py-1.5 rounded-full">
                <User className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-xs md:text-sm font-bold text-slate-200">{currentUser.username}</span>
                <div className="h-4 w-px bg-slate-800 mx-1" />
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-black text-yellow-400">{currentUser.tokens}</span>
                  <div className="w-4 h-4 bg-yellow-500 rounded-full border border-yellow-250 shadow-[0_0_10px_rgba(234,179,8,0.5)]" />
                </div>
              </div>
              <button
                onClick={handleLogout}
                className="p-2 text-slate-400 hover:text-rose-400 rounded-lg bg-slate-900 border border-slate-850 hover:border-rose-950 hover:bg-rose-950/20 transition-all cursor-pointer"
                title="Logout"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Primary Display state machine routing */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-8 flex items-center justify-center z-10">
        <AnimatePresence mode="wait">
          
          {/* SCREEN 1: LOGIN/REGISTER PROFILES */}
          {screen === "auth" && (
            <motion.div
              key="auth-panel"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.35 }}
              className="w-full max-w-md bg-slate-900/40 backdrop-blur-md border border-slate-800 rounded-2xl p-6 md:p-8 shadow-2xl relative"
            >
              <div className="text-center mb-6">
                <span className="text-[10px] md:text-xs font-mono font-bold tracking-widest text-cyan-400 uppercase bg-cyan-950/50 px-2.5 py-1 rounded-full border border-cyan-800/30">
                  ONLINE MULTIPLAYER ENGINE v1.2
                </span>
                <h3 className="text-2xl md:text-3xl font-black text-slate-100 font-sans tracking-tight mt-3">
                  {authMode === "login" ? "Enter the Arcade" : "Create Runner Node"}
                </h3>
                <p className="text-xs md:text-sm text-slate-400 mt-1">
                  {authMode === "login" ? "Sign in to access your persistent game profiles." : "Register an account to accumulate tokens database count."}
                </p>
              </div>

              {authError && (
                <div className="mb-4 text-xs font-mono flex items-center gap-2 bg-rose-950/40 text-rose-400 px-3.5 py-2.5 rounded-lg border border-rose-800/30">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{authError}</span>
                </div>
              )}

              <form onSubmit={handleAuthSubmit} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[11px] font-mono tracking-wider text-slate-400 uppercase block">Runner Username</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      type="text"
                      placeholder="e.g. NeoRunner"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      disabled={authLoading}
                      className="w-full pl-9 pr-4 py-2.5 bg-slate-950 rounded-lg text-slate-100 border border-slate-800 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none text-xs md:text-sm transition-all font-mono"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-mono tracking-wider text-slate-400 uppercase block">Secure Password</label>
                  <div className="relative">
                    <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={authLoading}
                      className="w-full pl-9 pr-4 py-2.5 bg-slate-950 rounded-lg text-slate-100 border border-slate-800 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none text-xs md:text-sm transition-all"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={authLoading}
                  className="w-full py-3 px-4 bg-gradient-to-r from-cyan-500 to-rose-500 hover:from-cyan-400 hover:to-rose-400 hover:shadow-[0_0_15px_rgba(6,182,212,0.4)] disabled:from-slate-800 disabled:to-slate-900 disabled:text-slate-500 font-extrabold text-slate-950 uppercase tracking-widest text-[11px] sm:text-xs rounded-lg transition-all flex items-center justify-center gap-2 mt-2"
                >
                  {authLoading ? (
                    "Connecting..."
                  ) : (
                    <>
                      <span>{authMode === "login" ? "INITIALIZE LOGIN" : "PROVISION REGISTER"}</span>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-950" />
                    </>
                  )}
                </button>
              </form>

              <div className="mt-6 pt-4 border-t border-slate-800/60 text-center">
                <button
                  onClick={() => {
                    setAuthMode(authMode === "login" ? "register" : "login");
                    setAuthError("");
                  }}
                  disabled={authLoading}
                  className="text-xs font-mono text-cyan-400 hover:text-cyan-300 hover:underline transition-all"
                >
                  {authMode === "login"
                    ? "New runner? Create a registration ID →"
                    : "Back to standard authentication lobby login →"}
                </button>
              </div>
            </motion.div>
          )}

          {/* SCREEN 2: MATCHMAKING SELECTION */}
          {screen === "dashboard" && (
            <motion.div
              key="dashboard-panel"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="w-full max-w-2xl bg-slate-900/60 backdrop-blur-xl border border-slate-700/40 rounded-3xl p-6 md:p-8 shadow-2xl space-y-6"
            >
              <div className="text-center">
                <span className="text-[10px] md:text-xs font-mono font-black tracking-widest text-cyan-400 uppercase bg-cyan-950/40 px-3 py-1 rounded-full border border-cyan-800/30">
                  Lobby Matchmaking Center
                </span>
                <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-slate-100 via-slate-200 to-slate-400 font-display mt-3">
                  Race Launcher
                </h2>
                <p className="text-xs md:text-sm text-slate-400 mt-1 max-w-sm mx-auto">
                  Start an authoritative 3-player challenge or input a friend's active Room ID code to sync up.
                </p>
              </div>

              {lobbyError && (
                <div className="p-3.5 bg-rose-950/40 border border-rose-800/30 text-rose-400 rounded-lg text-xs font-mono text-center flex items-center justify-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  <span>{lobbyError}</span>
                </div>
              )}

              <div className="grid md:grid-cols-2 gap-6 pt-2">
                {/* Create Room Selection */}
                <div className="flex flex-col justify-between bg-slate-950/50 hover:bg-slate-900/40 p-6 rounded-2xl border border-slate-700/30 hover:border-cyan-500/30 shadow-lg hover:shadow-cyan-500/5 transition-all space-y-4 group">
                  <div className="space-y-2">
                    <div className="w-10 h-10 rounded-lg bg-cyan-950/60 flex items-center justify-center text-cyan-400 border border-cyan-850/30">
                      <PlusCircle className="w-5 h-5" />
                    </div>
                    <h3 className="text-base font-bold font-display text-slate-200">Host New Match</h3>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Initialize a brand new racing grid room. You will receive a 4-character coordination ID to share with two other players.
                    </p>
                  </div>
                  <button
                    onClick={handleCreateRoom}
                    className="w-full py-3 px-4 bg-cyan-500 text-slate-950 hover:bg-cyan-400 hover:shadow-[0_0_20px_rgba(6,182,212,0.4)] font-extrabold uppercase tracking-widest text-[10px] md:text-xs rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <span>CREATE ROOM</span>
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-all text-slate-950" />
                  </button>
                </div>

                {/* Join Room Selection */}
                <form
                  onSubmit={handleJoinRoom}
                  className="flex flex-col justify-between bg-slate-950/50 hover:bg-slate-900/40 p-6 rounded-2xl border border-slate-700/30 hover:border-rose-500/30 shadow-lg hover:shadow-rose-500/5 transition-all space-y-4 group"
                >
                  <div className="space-y-2">
                    <div className="w-10 h-10 rounded-lg bg-rose-950/60 flex items-center justify-center text-rose-400 border border-rose-850/30">
                      <Compass className="w-5 h-5" />
                    </div>
                    <h3 className="text-base font-bold font-display text-slate-200">Find Active Grid</h3>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Enter the 4-character ID of an existing room slot to sync up coordinates inside their matching lobby.
                    </p>
                  </div>

                  <div className="space-y-2 pt-1">
                    <input
                      type="text"
                      maxLength={4}
                      placeholder="e.g. J29A"
                      value={joinRoomId}
                      onChange={(e) => setJoinRoomId(e.target.value.toUpperCase())}
                      className="w-full py-2 bg-slate-950 rounded-lg text-center text-slate-100 border border-slate-800 placeholder:text-slate-700 focus:border-rose-500 focus:ring-1 focus:ring-rose-500 outline-none text-xs font-mono font-black"
                    />
                    <button
                      type="submit"
                      className="w-full py-3 px-4 bg-rose-500 text-white hover:bg-rose-400 hover:shadow-[0_0_20px_rgba(244,63,94,0.4)] font-extrabold uppercase tracking-widest text-[10px] md:text-xs rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <span>JOIN ROOM</span>
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-all text-white" />
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          )}

          {/* SCREEN 3: LOBBY MATCHMAKING WAITING AREA */}
          {screen === "lobby" && currentRoom && (
            <motion.div
              key="lobby-panel"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="w-full max-w-xl bg-slate-900/60 backdrop-blur-xl border border-slate-700/40 rounded-3xl p-6 md:p-8 shadow-2xl relative"
            >
              <div className="text-center mb-6">
                <span className="text-[10px] font-mono font-black tracking-widest text-[#22d3ee] uppercase bg-[#22d3ee]/10 px-3 py-1 rounded-full border border-cyan-800/20">
                  Room Matching Lobby
                </span>
                <div className="flex items-center justify-center gap-2 mt-4">
                  <h2 className="text-4xl md:text-5xl font-black font-display tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-indigo-400 uppercase">
                    {currentRoom.id}
                  </h2>
                  <button
                    onClick={copyRoomCodeToClipboard}
                    className="p-2 rounded-xl bg-slate-950 border border-slate-800 hover:bg-slate-900 hover:text-cyan-400 transition-all text-slate-400 cursor-pointer"
                    title="Copy room code"
                  >
                    {copied ? <CheckCircle className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-xs text-slate-400 mt-3 font-mono">
                  Share this Room ID code. Exactly 3 registered runners must enter to engage countdown locks.
                </p>
              </div>

              {lobbyError && (
                <div className="mb-4 text-xs font-mono text-cyan-400 text-center bg-cyan-950/40 border border-cyan-800/30 px-3.5 py-2.5 rounded-lg">
                  {lobbyError}
                </div>
              )}

              {/* Lobby slots listing with custom card visualizations */}
              <div className="space-y-3 mb-6">
                {Array.from({ length: 3 }).map((_, idx) => {
                  const player = currentRoom.players[idx];
                  const stateColor = GAME_COLORS[idx];
                  
                  return (
                    <div
                      key={idx}
                      style={{ borderColor: player ? `${stateColor}66` : "rgba(30,41,59,0.3)" }}
                      className={`flex items-center justify-between p-4 rounded-xl border transition-all ${
                        player
                          ? "bg-slate-950/80 shadow-lg"
                          : "bg-slate-950/20 border-dashed border-slate-800"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          style={{
                            backgroundColor: player ? stateColor : "rgba(15,23,42,0.5)",
                            color: player ? "#0f172a" : "#475569"
                          }}
                          className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs tracking-tighter"
                        >
                          {idx + 1}
                        </div>
                        <div>
                          <h4 className={`text-xs md:text-sm font-bold ${player ? "text-slate-200" : "text-slate-600 font-mono"}`}>
                            {player ? player.username : "WAITING FOR REGISTERED RUNNER..."}
                          </h4>
                          {player && (
                            <span className="text-[10px] font-mono text-slate-500">
                              Connected system: {player.socketId.substring(0, 6)}
                            </span>
                          )}
                        </div>
                      </div>

                      {player ? (
                        <span style={{ color: stateColor, borderColor: `${stateColor}33`, backgroundColor: `${stateColor}11` }} className="text-[10px] font-mono font-semibold flex items-center gap-1.5 px-3 py-1 rounded-full border">
                          <span style={{ backgroundColor: stateColor }} className="w-1.5 h-1.5 rounded-full animate-pulse" />
                          READY
                        </span>
                      ) : (
                        <span className="text-[10px] font-mono font-semibold text-slate-700 animate-pulse">
                          WAITING...
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Back controls */}
              <button
                onClick={handleLeaveLobby}
                className="w-full py-3 text-center text-xs font-mono font-bold text-slate-400 hover:text-white bg-slate-950 hover:bg-slate-900 border border-slate-800 rounded-xl transition-all cursor-pointer"
              >
                DISCONNECT FROM ROOM
              </button>
            </motion.div>
          )}

          {/* SCREEN 4: GAME AREA WITH ACTIVE CANVAS */}
          {screen === "game" && currentRoom && (
            <motion.div
              key="game-panel"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="w-full h-[520px] flex flex-col relative"
            >
              <ParkourGameCanvas
                socket={socketRef.current!}
                roomId={currentRoom.id}
                myUsername={currentUser?.username || "You"}
                players={currentRoom.players}
                onFinishRace={() => {}}
                gameStatus={currentRoom.status}
                countdownSeconds={currentRoom.countdownSeconds}
              />

              {/* Authoritative victory overlay frame layout */}
              {winnerName && (
                <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-slate-950/80 backdrop-blur-md animate-fade-in px-4">
                  
                  {/* Dynamic Token Coin Floating Particles */}
                  {coinsCelebration.map((coin) => (
                    <motion.div
                      key={coin.id}
                      initial={{ opacity: 0, scale: 0, y: 150 }}
                      animate={{
                        opacity: [0, 1, 1, 0],
                        scale: [0.5, 1.2, 1, 0.7],
                        x: [0, (coin.left - 50) * 12, (coin.left - 50) * 16, 250], // Flows into top profile area!
                        y: [0, (coin.top - 50) * -12, (coin.top - 50) * -16, -220]
                      }}
                      transition={{
                        duration: 1.8,
                        delay: coin.delay,
                        ease: "easeOut"
                      }}
                      className="absolute p-2 bg-yellow-500 rounded-full border border-yellow-250 shadow-[0_0_12px_#eab308] text-slate-950"
                    >
                      <Coins className="w-5 h-5 animate-bounce-slow" />
                    </motion.div>
                  ))}

                  <motion.div
                    initial={{ opacity: 0, scale: 0.94 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 md:p-8 text-center shadow-2xl relative"
                  >
                    <div className="w-16 h-16 rounded-full bg-yellow-950/60 border border-yellow-800/40 flex items-center justify-center mx-auto text-yellow-400 shadow-lg mb-4">
                      <Trophy className="w-8 h-8 animate-bounce-slow" />
                    </div>

                    <span className="text-[10px] font-mono tracking-widest text-yellow-400 uppercase bg-yellow-950/50 px-2.5 py-1 rounded-full border border-yellow-800/30">
                      Circuit Victory
                    </span>

                    <h3 className="text-xl md:text-2xl font-black text-slate-100 font-sans tracking-tight mt-3">
                      {winnerName.toUpperCase() === (currentUser?.username || "").toUpperCase() ? "YOU WON THE RACE!" : `${winnerName.toUpperCase()} IS VICTORIOUS`}
                    </h3>
                    <p className="text-xs md:text-sm text-slate-400 mt-2 max-w-xs mx-auto">
                      {winnerName.toUpperCase() === (currentUser?.username || "").toUpperCase() 
                        ? "+1 Token written authoritatively to your database runner profile count." 
                        : "Better luck in the next track sprint runner."}
                    </p>

                    <div className="mt-6 flex flex-col gap-2">
                      <button
                        onClick={handleLeaveLobby}
                        className="w-full py-2.5 px-4 bg-gradient-to-r from-cyan-500 to-rose-500 hover:from-cyan-400 hover:to-rose-400 text-slate-950 font-extrabold uppercase tracking-wider text-[11px] sm:text-xs rounded-lg transition-all flex items-center justify-center gap-1.5"
                      >
                        <RotateCcw className="w-4 h-4 text-slate-950" />
                        <span>RETURN TO LOBBY</span>
                      </button>
                    </div>
                  </motion.div>
                </div>
              )}
            </motion.div>
          )}

        </AnimatePresence>
      </main>

      {/* Humble literal microfooter footer */}
      <footer className="py-4 text-center border-t border-slate-950 bg-slate-950/60 font-mono text-[9px] md:text-[10px] text-slate-600 z-10 select-none">
        <div>3-PLAYER REAL-TIME CANVAS RACING GAME</div>
        <div className="mt-1 opacity-60">Interpolated Coordinate Streams &bull; Persistent Profiles</div>
      </footer>
    </div>
  );
}
