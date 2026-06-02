export interface User {
  username: string;
  tokens: number;
}

export interface Opponent {
  socketId: string;
  username: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  isJumping: boolean;
  isSliding: boolean;
  colorIndex: number;
  // Lerp tracking parameters for smooth anti-jitter visualization
  targetX: number;
  targetY: number;
}

export interface MatchPlayer {
  socketId: string;
  username: string;
  colorIndex: number;
  status: string;
}

export interface GameRoom {
  id: string;
  players: MatchPlayer[];
  status: "waiting" | "countdown" | "racing" | "ended";
  countdownSeconds: number;
}

export interface Platform {
  id?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  type: "normal" | "glowing" | "boost" | "hurdle" | "wall" | "spring";
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

export const GAME_COLORS = [
  "#22d3ee", // Cyan - Player 0
  "#f43f5e", // Rose/Magenta - Player 1
  "#eab308", // Yellow - Player 2
];
