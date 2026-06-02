import express from "express";
import path from "path";
import http from "http";
import { Server, Socket } from "socket.io";
import fs from "fs";
import { createServer as createViteServer } from "vite";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = 3000;
const DATABASE_FILE = path.join(process.cwd(), "users.json");

// Helper to ensure database file exists and is valid JSON
function initDatabase() {
  try {
    if (!fs.existsSync(DATABASE_FILE)) {
      fs.writeFileSync(DATABASE_FILE, JSON.stringify({}, null, 2), "utf-8");
    } else {
      // Validate structure, reset if corrupted
      const content = fs.readFileSync(DATABASE_FILE, "utf-8");
      JSON.parse(content);
    }
  } catch (error) {
    console.error("Database initialization issue, resetting users.json:", error);
    fs.writeFileSync(DATABASE_FILE, JSON.stringify({}, null, 2), "utf-8");
  }
}

// Read database
function readDatabase() {
  try {
    initDatabase();
    const data = fs.readFileSync(DATABASE_FILE, "utf-8");
    return JSON.parse(data);
  } catch (err) {
    return {};
  }
}

// Write database
function writeDatabase(data: any) {
  try {
    fs.writeFileSync(DATABASE_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error("Error writing database:", err);
  }
}

app.use(express.json());

// API Endpoints
app.post("/api/register", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: "Username and password required" });
    return;
  }

  const normalizedUsername = username.trim().toLowerCase();
  const db = readDatabase();

  if (db[normalizedUsername]) {
    res.status(400).json({ error: "Username already exists" });
    return;
  }

  db[normalizedUsername] = {
    username: username.trim(),
    password, // Plain credentials for test/prototype application
    tokens: 0
  };

  writeDatabase(db);
  res.json({ success: true, user: { username: username.trim(), tokens: 0 } });
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: "Username and password required" });
    return;
  }

  const normalizedUsername = username.trim().toLowerCase();
  const db = readDatabase();

  const user = db[normalizedUsername];
  if (!user || user.password !== password) {
    res.status(400).json({ error: "Invalid username or password" });
    return;
  }

  res.json({ success: true, user: { username: user.username, tokens: user.tokens } });
});

app.get("/api/profile/:username", (req, res) => {
  const username = req.params.username;
  const normalizedUsername = username.trim().toLowerCase();
  const db = readDatabase();

  const user = db[normalizedUsername];
  if (!user) {
    res.status(404).json({ error: "Player not found" });
    return;
  }

  res.json({ username: user.username, tokens: user.tokens });
});

// Socket.io Real-time Matchmaking & Game Coordination
interface Player {
  socketId: string;
  username: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  isJumping: boolean;
  isSliding: boolean;
  colorIndex: number; // 0=Cyan, 1=Magenta, 2=Yellow
}

interface Room {
  id: string;
  players: Player[];
  status: "waiting" | "countdown" | "racing" | "ended";
  countdownSeconds: number;
  winner?: string;
  timerInterval?: NodeJS.Timeout;
}

const activeRooms: Record<string, Room> = {};

// Helper to generate a unique room code
function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // No confusing symbols
  let code = "";
  do {
    code = "";
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  } while (activeRooms[code]);
  return code;
}

io.on("connection", (socket: Socket) => {
  console.log(`Socket client connected: ${socket.id}`);

  let currentRoomId: string | null = null;
  let socketUsername: string | null = null;

  socket.on("join-lobby", ({ username }: { username: string }) => {
    socketUsername = username;
  });

  socket.on("create-room", () => {
    if (!socketUsername) {
      socket.emit("error", "Not authenticated with a username.");
      return;
    }

    const roomId = generateRoomCode();
    const player: Player = {
      socketId: socket.id,
      username: socketUsername,
      x: 100,
      y: 350,
      vx: 0,
      vy: 0,
      isJumping: false,
      isSliding: false,
      colorIndex: 0
    };

    activeRooms[roomId] = {
      id: roomId,
      players: [player],
      status: "waiting",
      countdownSeconds: 5
    };

    currentRoomId = roomId;
    socket.join(`room:${roomId}`);
    socket.emit("room-created", { roomId, players: activeRooms[roomId].players });
    console.log(`Room created: ${roomId} by ${socketUsername}`);
  });

  socket.on("join-room", ({ roomId }: { roomId: string }) => {
    if (!socketUsername) {
      socket.emit("error", "Not authenticated with a username.");
      return;
    }

    const upperRoomId = roomId.toUpperCase().trim();
    const room = activeRooms[upperRoomId];

    if (!room) {
      socket.emit("error", "Room not found. Check the code and try again.");
      return;
    }

    if (room.status !== "waiting") {
      socket.emit("error", "The race in this room has already started or completed.");
      return;
    }

    if (room.players.length >= 3) {
      socket.emit("error", "Room is already full! Maximum is 3 players.");
      return;
    }

    // Assign color indicator
    const colorIndex = room.players.length;

    const newPlayer: Player = {
      socketId: socket.id,
      username: socketUsername,
      x: 100 + colorIndex * 60, // Stagger slightly in starting gate
      y: 350,
      vx: 0,
      vy: 0,
      isJumping: false,
      isSliding: false,
      colorIndex
    };

    room.players.push(newPlayer);
    currentRoomId = upperRoomId;
    socket.join(`room:${upperRoomId}`);

    io.to(`room:${upperRoomId}`).emit("room-updated", { roomId: upperRoomId, players: room.players, status: room.status });
    console.log(`User ${socketUsername} joined Room ${upperRoomId}. Total: ${room.players.length}`);

    // If exact 3-player lock achieved, launch dramatic countdown!
    if (room.players.length === 3) {
      triggerRoomCountdown(upperRoomId);
    }
  });

  // Racing coordinates synchronization channel
  socket.on("sync-position", (posData: { x: number; y: number; vx: number; vy: number; isJumping: boolean; isSliding: boolean }) => {
    if (!currentRoomId) return;
    const room = activeRooms[currentRoomId];
    if (!room || room.status !== "racing") return;

    // Update server state for absolute coordinates authority
    const player = room.players.find(p => p.socketId === socket.id);
    if (player) {
      player.x = posData.x;
      player.y = posData.y;
      player.vx = posData.vx;
      player.vy = posData.vy;
      player.isJumping = posData.isJumping;
      player.isSliding = posData.isSliding;
    }

    // Broadcast positions to opponents in the same room. Use volatile for high frequency network optimization.
    socket.to(`room:${currentRoomId}`).emit("opponent-sync", {
      socketId: socket.id,
      x: posData.x,
      y: posData.y,
      vx: posData.vx,
      vy: posData.vy,
      isJumping: posData.isJumping,
      isSliding: posData.isSliding
    });
  });

  // Winner calculation and persistence channel
  socket.on("race-finished", () => {
    if (!currentRoomId) return;
    const room = activeRooms[currentRoomId];
    if (!room || room.status !== "racing") return;

    room.status = "ended";
    const winnerPlayer = room.players.find(p => p.socketId === socket.id);
    const winnerUsername = winnerPlayer ? winnerPlayer.username : (socketUsername || "Unknown");
    room.winner = winnerUsername;

    // Persist winner token update to database
    const db = readDatabase();
    const normalizedWinner = winnerUsername.trim().toLowerCase();
    
    let currentTokens = 0;
    if (db[normalizedWinner]) {
      db[normalizedWinner].tokens += 1;
      currentTokens = db[normalizedWinner].tokens;
      writeDatabase(db);
    }

    // Notify all room members of victory to halt canvas action, freeze interactions, and show token progression
    io.to(`room:${currentRoomId}`).emit("race-over", {
      winner: winnerUsername,
      winnerSocketId: socket.id,
      newTokens: currentTokens
    });

    console.log(`Race Finished in room ${room.id}. Winner: ${winnerUsername}. New Tokens: ${currentTokens}`);
  });

  // Disconnection cleanup helper
  socket.on("disconnect", () => {
    console.log(`Socket disconnected: ${socket.id}`);
    if (currentRoomId && activeRooms[currentRoomId]) {
      const room = activeRooms[currentRoomId];
      
      // Clear timers if host leaves or room dissolves
      if (room.timerInterval) {
        clearInterval(room.timerInterval);
      }

      // Remove player
      room.players = room.players.filter(p => p.socketId !== socket.id);

      if (room.players.length === 0) {
        delete activeRooms[currentRoomId];
        console.log(`Room dissolved: ${currentRoomId} (all players left)`);
      } else {
        // Reset room back to lobby waiting state if the game wasn't already completed
        if (room.status !== "ended") {
          room.status = "waiting";
          room.countdownSeconds = 5;
          io.to(`room:${currentRoomId}`).emit("room-updated", {
            roomId: currentRoomId,
            players: room.players,
            status: room.status,
            leftNotification: socketUsername || "A player"
          });
        }
      }
    }
  });
});

// Broadcast countdown ticksAUTHORITATIVE server state
function triggerRoomCountdown(roomId: string) {
  const room = activeRooms[roomId];
  if (!room) return;

  room.status = "countdown";
  room.countdownSeconds = 5;

  io.to(`room:${roomId}`).emit("countdown-start", { seconds: room.countdownSeconds });

  room.timerInterval = setInterval(() => {
    room.countdownSeconds--;
    
    if (room.countdownSeconds <= 0) {
      if (room.timerInterval) {
        clearInterval(room.timerInterval);
        room.timerInterval = undefined;
      }
      room.status = "racing";
      io.to(`room:${roomId}`).emit("game-start");
      console.log(`Game started in room ${roomId}!`);
    } else {
      io.to(`room:${roomId}`).emit("countdown-tick", { seconds: room.countdownSeconds });
    }
  }, 1000);
}

// Initial DB Check
initDatabase();

// Integrate Vite Middleware
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server fully listening on http://0.0.0.0:${PORT} in ${process.env.NODE_ENV || "development"} mode.`);
  });
}

startServer();
