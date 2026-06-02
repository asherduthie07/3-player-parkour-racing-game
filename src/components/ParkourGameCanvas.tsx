import React, { useRef, useEffect, useState } from "react";
import { Socket } from "socket.io-client";
import { Opponent, Platform, Particle, GAME_COLORS } from "../types";
import { Trophy, Shield, Zap, Sparkles, Volume2, MoveHorizontal } from "lucide-react";

interface ParkourGameCanvasProps {
  socket: Socket;
  roomId: string;
  myUsername: string;
  players: Array<{ socketId: string; username: string; colorIndex: number }>;
  onFinishRace: () => void;
  gameStatus: "countdown" | "racing" | "ended";
  countdownSeconds: number;
}

// Fixed map dimensions
const MAP_WIDTH = 3400;
const MAP_HEIGHT = 480;
const GRAVITY = 0.55;
const FRICTION = 0.82;
const JUMP_FORCE = -12.5;
const CLIMB_SPEED = -3;
const SPEED_LIMIT = 8;
const BOOST_ACCEL = 1.8;

// Define static platforms forming our parkour hazard course
const PLATFORMS: Platform[] = [
  // Starting gates safety floor
  { x: 0, y: 430, width: 450, height: 50, type: "normal" },
  
  // Platform Set 1
  { x: 260, y: 320, width: 140, height: 18, type: "glowing" },
  { x: 450, y: 240, width: 140, height: 18, type: "normal" },
  
  // Hurdle 1 (Requires clean jump)
  { x: 620, y: 350, width: 35, height: 80, type: "hurdle" },
  { x: 600, y: 430, width: 500, height: 50, type: "normal" }, // Main floor continues
  
  // High climbing Wall (Requires wall sliding & jumping to bypass)
  { x: 850, y: 150, width: 30, height: 280, type: "wall" },
  { x: 740, y: 280, width: 80, height: 18, type: "glowing" },
  
  // Elevated reward path
  { x: 920, y: 220, width: 150, height: 18, type: "normal" },
  { x: 1100, y: 140, width: 150, height: 18, type: "normal" },
  
  // Speed boost pad 1
  { x: 1150, y: 420, width: 120, height: 10, type: "boost" },
  { x: 1100, y: 430, width: 400, height: 50, type: "normal" },
  
  // Chasm / Gap (Deadly pitfall)
  // Gap is from x = 1500 to x = 1750 (250px jump!)
  { x: 1750, y: 430, width: 450, height: 50, type: "normal" },
  
  // Small floaters over the deadly pitfall to assist those who missed the boost
  { x: 1530, y: 290, width: 60, height: 15, type: "glowing" },
  { x: 1650, y: 240, width: 60, height: 15, type: "glowing" },
  
  // Spring pad launcher
  { x: 1850, y: 420, width: 50, height: 10, type: "spring" },
  
  // Large platform complex (Requires S/Down sliding path under low ceiling)
  { x: 1980, y: 310, width: 320, height: 15, type: "normal" },
  { x: 1980, y: 230, width: 320, height: 15, type: "hurdle" }, // Low ceiling barrier
  
  // Another gap from x = 2300 to x = 2480
  { x: 2480, y: 430, width: 920, height: 50, type: "normal" },
  
  // Stepping stones over second gap
  { x: 2340, y: 300, width: 50, height: 15, type: "normal" },
  { x: 2420, y: 230, width: 50, height: 15, type: "glowing" },
  
  // Final stretch speed pads & final hurdle
  { x: 2600, y: 420, width: 100, height: 10, type: "boost" },
  { x: 2820, y: 350, width: 40, height: 80, type: "hurdle" },
  { x: 2950, y: 420, width: 100, height: 10, type: "boost" },
];

export default function ParkourGameCanvas({
  socket,
  roomId,
  myUsername,
  players,
  onFinishRace,
  gameStatus,
  countdownSeconds,
}: ParkourGameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Sound settings
  const [soundEnabled, setSoundEnabled] = useState(true);

  // Local physical player state (controlled by keyboard)
  const localPlayerRef = useRef({
    x: 100,
    y: 350,
    vx: 0,
    vy: 0,
    width: 20,
    height: 42,
    originalHeight: 42,
    slidingHeight: 22,
    isGrounded: false,
    isJumping: false,
    isSliding: false,
    colorIndex: 0,
    username: myUsername,
    checkpointX: 100,
    checkpointY: 350,
    climbingWall: false,
    facingRight: true,
  });

  // Track opponents locally with lerp coordinate queues
  const opponentsRef = useRef<Record<string, Opponent>>({});
  
  // Keyboard keys tracker
  const keysPressed = useRef<Record<string, boolean>>({});
  
  // Sparkle visual particle emitters
  const particlesRef = useRef<Particle[]>([]);

  // Camera scroll tracking
  const [cameraX, setCameraX] = useState(0);

  // Retrieve my player model parameters
  useEffect(() => {
    const me = players.find((p) => p.username === myUsername);
    if (me) {
      localPlayerRef.current.colorIndex = me.colorIndex;
      localPlayerRef.current.x = 100 + me.colorIndex * 60;
      localPlayerRef.current.checkpointX = 100 + me.colorIndex * 60;
    }

    // Populate initial opponents list
    const initialOpponents: Record<string, Opponent> = {};
    players.forEach((p) => {
      if (p.username !== myUsername) {
        initialOpponents[p.socketId] = {
          socketId: p.socketId,
          username: p.username,
          x: 100 + p.colorIndex * 60,
          y: 350,
          vx: 0,
          vy: 0,
          isJumping: false,
          isSliding: false,
          colorIndex: p.colorIndex,
          targetX: 100 + p.colorIndex * 60,
          targetY: 350,
        };
      }
    });
    opponentsRef.current = initialOpponents;
  }, [players, myUsername]);

  // Audio utility: Synth frequency generator using HTML5 Web Audio API
  const playSynthBeep = (freq: number, type: OscillatorType, duration: number) => {
    if (!soundEnabled) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (e) {
      console.warn("Audio synth beep warning:", e);
    }
  };

  // Trigger audio beeps matching countdown pacing live
  useEffect(() => {
    if (gameStatus === "countdown") {
      if (countdownSeconds > 0) {
        // Low electronic standard tick
        playSynthBeep(330, "sine", 0.15);
      } else if (countdownSeconds === 0) {
        // Intense high celebratory retro starting chirp
        playSynthBeep(880, "sawtooth", 0.4);
      }
    }
  }, [countdownSeconds, gameStatus]);

  // Set up socket listeners for positions coordination
  useEffect(() => {
    // 1. Position broker
    socket.on(
      "opponent-sync",
      (data: {
        socketId: string;
        x: number;
        y: number;
        vx: number;
        vy: number;
        isJumping: boolean;
        isSliding: boolean;
      }) => {
        const opponent = opponentsRef.current[data.socketId];
        if (opponent) {
          // Store actual target received from server. Our frame-loop will smoothly LERP to it.
          opponent.targetX = data.x;
          opponent.targetY = data.y;
          opponent.vx = data.vx;
          opponent.vy = data.vy;
          opponent.isJumping = data.isJumping;
          opponent.isSliding = data.isSliding;
        }
      }
    );

    return () => {
      socket.off("opponent-sync");
    };
  }, [socket]);

  // Manage client canvas size and resize trackers
  useEffect(() => {
    const handleResize = () => {
      if (!canvasRef.current || !containerRef.current) return;
      canvasRef.current.width = containerRef.current.clientWidth;
      canvasRef.current.height = 420; // Bound standard aspect depth nicely
    };

    window.addEventListener("resize", handleResize);
    handleResize();

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  // Listen for keyboard controls directly
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Prevent standard browser scrolling behaviors for game keys
      if (["Space", "ArrowUp", "ArrowDown", "KeyW", "KeyS"].includes(e.code)) {
        e.preventDefault();
      }
      keysPressed.current[e.code] = true;
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keysPressed.current[e.code] = false;
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // Main client-side 60fps game loop
  useEffect(() => {
    let animationFrameId: number;
    let lastTime = performance.now();
    let tickCount = 0;

    const gameLoop = () => {
      const now = performance.now();
      const deltaTime = (now - lastTime) / 1000;
      lastTime = now;

      updateLocalPlayer();
      updateOpponentsLerp();
      updateParticles();
      checkWinningTrigger();

      // Emit position to server on high frequency (approx 30 updates/sec to prevent network bloat)
      tickCount++;
      if (tickCount % 2 === 0 && gameStatus === "racing") {
        const playerState = localPlayerRef.current;
        socket.emit("sync-position", {
          x: playerState.x,
          y: playerState.y,
          vx: playerState.vx,
          vy: playerState.vy,
          isJumping: playerState.isJumping,
          isSliding: playerState.isSliding,
        });
      }

      drawGame();

      animationFrameId = requestAnimationFrame(gameLoop);
    };

    // Update physical dimensions and collision logic of my browser controlled shell
    const updateLocalPlayer = () => {
      const p = localPlayerRef.current;

      if (gameStatus !== "racing") {
        // Apply friction to stop moving players gracefully
        p.vx *= FRICTION;
        p.vy += GRAVITY;
        p.y += p.vy;
        
        // Floor checks during waiting
        if (p.y > 380) {
          p.y = 380;
          p.vy = 0;
          p.isGrounded = true;
        }
        return;
      }

      // Check sliders configuration
      p.isSliding = !!(keysPressed.current["ArrowDown"] || keysPressed.current["KeyS"]);
      if (p.isSliding) {
        p.height = p.slidingHeight;
      } else {
        // Prevent unsquishing if inside a hurdle ceiling block to prevent glitches
        const wouldColideCeiling = PLATFORMS.some(
          (plat) =>
            p.x + p.width > plat.x &&
            p.x < plat.x + plat.width &&
            p.y - (p.originalHeight - p.slidingHeight) < plat.y + plat.height &&
            p.y > plat.y
        );
        if (!wouldColideCeiling) {
          p.height = p.originalHeight;
        } else {
          p.isSliding = true; // Force slide index
        }
      }

      // Apply controls
      const moveLeft = keysPressed.current["ArrowLeft"] || keysPressed.current["KeyA"];
      const moveRight = keysPressed.current["ArrowRight"] || keysPressed.current["KeyD"];
      const jump = keysPressed.current["Space"] || keysPressed.current["ArrowUp"] || keysPressed.current["KeyW"];

      if (moveLeft) {
        p.vx -= 0.6;
        p.facingRight = false;
        // Trail dust
        if (p.isGrounded && Math.random() < 0.25) {
          createDustParticle(p.x + p.width / 2, p.y + p.height, GAME_COLORS[p.colorIndex]);
        }
      } else if (moveRight) {
        p.vx += 0.6;
        p.facingRight = true;
        // Trail dust
        if (p.isGrounded && Math.random() < 0.25) {
          createDustParticle(p.x + p.width / 2, p.y + p.height, GAME_COLORS[p.colorIndex]);
        }
      } else {
        p.vx *= FRICTION;
      }

      // Limit max velocities unless on a velocity booster pad
      const limit = p.isSliding ? SPEED_LIMIT * 0.7 : SPEED_LIMIT;
      if (p.vx > limit) p.vx = limit;
      if (p.vx < -limit) p.vx = -limit;

      // Apply Gravity
      p.vy += GRAVITY;

      // Wall climbing mechanics
      p.climbingWall = false;
      const touchingWall = PLATFORMS.some((plat) => {
        if (plat.type === "wall") {
          // Check horizontal proximity and vertical alignment
          const offset = 4;
          const againstLeft = p.x + p.width >= plat.x - offset && p.x + p.width <= plat.x + 5 && p.y + p.height > plat.y && p.y < plat.y + plat.height;
          const againstRight = p.x <= plat.x + plat.width + offset && p.x >= plat.x + plat.width - 5 && p.y + p.height > plat.y && p.y < plat.y + plat.height;
          return againstLeft || againstRight;
        }
        return false;
      });

      if (touchingWall && !p.isGrounded && p.vy > 0) {
        p.climbingWall = true;
        p.vy = CLIMB_SPEED; // Slowly slide down/wallclimb
        if (Math.random() < 0.2) {
          createDustParticle(p.x + p.width / 2, p.y + p.height / 2, "#ffffff");
        }
      }

      // Horizontal update
      p.x += p.vx;
      handleTileCollisions("horizontal");

      // Vertical update
      p.y += p.vy;
      p.isGrounded = false;
      handleTileCollisions("vertical");

      // Handle jumping action
      if (jump) {
        if (p.isGrounded) {
          p.vy = JUMP_FORCE;
          p.isGrounded = false;
          p.isJumping = true;
          playSynthBeep(260, "sine", 0.1);

          // Jumping burst
          for (let i = 0; i < 8; i++) {
            createDustParticle(p.x + p.width / 2, p.y + p.height, GAME_COLORS[p.colorIndex]);
          }
        } else if (p.climbingWall) {
          // Wall jump off!
          p.vy = JUMP_FORCE * 0.85;
          p.vx = p.facingRight ? -SPEED_LIMIT * 1.1 : SPEED_LIMIT * 1.1;
          p.facingRight = !p.facingRight;
          p.climbingWall = false;
          p.isJumping = true;
          playSynthBeep(320, "sine", 0.1);

          for (let i = 0; i < 8; i++) {
            createDustParticle(p.x + p.width / 2, p.y + p.height / 2, GAME_COLORS[p.colorIndex]);
          }
        }
      }

      // Check death / pit falls (y threshold bottom boundaries)
      if (p.y > MAP_HEIGHT) {
        triggerDeathRespawn();
      }

      // Set camera bound based on local player horizontal progress
      if (canvasRef.current) {
        const offsetLeft = canvasRef.current.width * 0.35;
        const targetCamX = p.x - offsetLeft;
        
        // Gentle smooth damp camera progression
        const scrollSpeed = 0.12;
        const potentialCamX = cameraX + (targetCamX - cameraX) * scrollSpeed;
        
        // Clamp bounds
        const maxScroll = MAP_WIDTH - canvasRef.current.width;
        setCameraX(Math.max(0, Math.min(potentialCamX, maxScroll)));
      }
    };

    // Respawn user at the last checkpoint platform they reached
    const triggerDeathRespawn = () => {
      const p = localPlayerRef.current;
      playSynthBeep(120, "sawtooth", 0.25);
      
      p.x = p.checkpointX;
      p.y = p.checkpointY;
      p.vx = 0;
      p.vy = 0;
      p.isGrounded = false;

      // Burst of death sparkles
      for (let i = 0; i < 15; i++) {
        createDustParticle(p.x, p.y, GAME_COLORS[p.colorIndex]);
      }
    };

    // Custom collision matrix parser
    const handleTileCollisions = (direction: "horizontal" | "vertical") => {
      const p = localPlayerRef.current;

      PLATFORMS.forEach((plat) => {
        // Core bounding overlap check
        const overlap =
          p.x < plat.x + plat.width &&
          p.x + p.width > plat.x &&
          p.y < plat.y + plat.height &&
          p.y + p.height > plat.y;

        if (overlap) {
          // Special Pad checks (trigger instantly)
          if (plat.type === "boost") {
            p.vx = p.facingRight ? SPEED_LIMIT * 1.6 : -SPEED_LIMIT * 1.6;
            if (Math.random() < 0.4) {
              createSparkleParticle(p.x + p.width / 2, p.y + p.height - 10, "#22c55e");
            }
            return;
          }

          if (plat.type === "spring") {
            p.vy = JUMP_FORCE * 1.45;
            p.isGrounded = false;
            playSynthBeep(520, "sine", 0.2);
            for (let i = 0; i < 10; i++) {
              createSparkleParticle(plat.x + plat.width / 2, plat.y, "#ef4444");
            }
            return;
          }

          // Solid tile alignment resolver
          if (direction === "horizontal") {
            if (p.vx > 0) {
              // Sliding right, hit left edge of tile
              p.x = plat.x - p.width;
              p.vx = 0;
            } else if (p.vx < 0) {
              // Sliding left, hit right edge of tile
              p.x = plat.x + plat.width;
              p.vx = 0;
            }
          } else {
            if (p.vy > 0) {
              // Falling down, hit top edge of tile
              p.y = plat.y - p.height;
              p.vy = 0;
              p.isGrounded = true;
              p.isJumping = false;

              // Save standard checkpoints as player safely touches solid platform grounds
              if (plat.type === "normal" || plat.type === "glowing") {
                p.checkpointX = plat.x + 30;
                p.checkpointY = plat.y - p.height - 10;
              }
            } else if (p.vy < 0) {
              // Jumping up, hit bottom edge of tile
              p.y = plat.y + plat.height;
              p.vy = 0;
            }
          }
        }
      });
    };

    /* 
      LAG_COMPENSATOR_ALGORITHM: Smooth Linear Interpolation (LERP)
      To avoid jittering during multiplayer synchronization, we do not set opponent
      coordinates abruptly. Instead, we receive their position signals at irregular 
      intervals and store them in `targetX` and `targetY`. Every single animation frame,
      we gently slide their current visual platformer bounds using an interpolation 
      multiplier.
    */
    const updateOpponentsLerp = () => {
      const opponents = opponentsRef.current;
      for (const id in opponents) {
        const o = opponents[id];
        // Interpolate over a dampening factor of 0.35 to offset latency jumps beautifully
        o.x += (o.targetX - o.x) * 0.35;
        o.y += (o.targetY - o.y) * 0.35;

        // Emit movement sparkles trail for beautiful visuals matching color keys
        if (Math.abs(o.vx) > 1 && Math.random() < 0.15) {
          createDustParticle(o.x + 10, o.y + 20, GAME_COLORS[o.colorIndex]);
        }
      }
    };

    // Update trail particles
    const updateParticles = () => {
      particlesRef.current = particlesRef.current.filter((pt) => {
        pt.x += pt.vx;
        pt.y += pt.vy;
        pt.life--;
        return pt.life > 0;
      });
    };

    // Emission factories
    const createDustParticle = (x: number, y: number, color: string) => {
      particlesRef.current.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 2,
        vy: (Math.random() - 0.5) * 2,
        life: 25 + Math.floor(Math.random() * 10),
        maxLife: 35,
        color,
        size: 1.5 + Math.random() * 2,
      });
    };

    const createSparkleParticle = (x: number, y: number, color: string) => {
      particlesRef.current.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 5,
        vy: -Math.random() * 4 - 1,
        life: 20 + Math.floor(Math.random() * 15),
        maxLife: 35,
        color,
        size: 2 + Math.random() * 3,
      });
    };

    // Authoritative finish gate trigger
    const checkWinningTrigger = () => {
      if (gameStatus === "racing") {
        const p = localPlayerRef.current;
        // Check local player coordinates against Finish line threshold coordinates
        if (p.x >= 3000) {
          // Immediately dispatch win signal to Socket server
          socket.emit("race-finished");
          onFinishRace();
        }
      }
    };

    // Complete Canvas Drawing Logic
    const drawGame = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Reset clean viewport
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Deep Space background with linear parallax grid lines
      ctx.save();
      ctx.fillStyle = "#0f172a"; // slate-900 background tint
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Simple grid parallax decor
      ctx.strokeStyle = "rgba(51, 65, 85, 0.25)"; // slate-700
      ctx.lineWidth = 1;

      const gridOffset = cameraX * 0.15; // Slow scroll paralax depth
      for (let x = -gridOffset % 40; x < canvas.width; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
      ctx.restore();

      // Everything underneath is relative to camera translation bounds
      ctx.save();
      ctx.translate(-cameraX, 0);

      // Draw Finish Gate visual arch decor
      drawFinishGate(ctx);

      // Draw static platform maps
      PLATFORMS.forEach((p) => {
        ctx.save();
        
        // Match decoration to functional platform state types
        if (p.type === "boost") {
          // Glow green speedpad
          ctx.fillStyle = "#22c55e";
          ctx.shadowBlur = 12;
          ctx.shadowColor = "#22c55e";
          ctx.fillRect(p.x, p.y, p.width, p.height);

          // Speed chevrons drawing
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 2;
          ctx.beginPath();
          const chevX = p.x + (Date.now() % 400) * 0.2;
          ctx.moveTo(chevX - 20, p.y + 2);
          ctx.lineTo(chevX, p.y + 5);
          ctx.lineTo(chevX - 20, p.y + 8);
          ctx.stroke();
        } else if (p.type === "spring") {
          // Hot Red Spring Board style
          ctx.fillStyle = "#ef4444";
          ctx.shadowBlur = 10;
          ctx.shadowColor = "#ef4444";
          ctx.fillRect(p.x, p.y, p.width, p.height);
          
          // Coil decor lines
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(p.x + 10, p.y + 2, p.width - 20, 3);
        } else if (p.type === "wall") {
          // Technical security barricade profile matching
          ctx.fillStyle = "#475569";
          ctx.fillRect(p.x, p.y, p.width, p.height);
          
          // Technical diagonal warning pattern overlays
          ctx.strokeStyle = "#f3f4f6";
          ctx.lineWidth = 3;
          for (let dy = p.y + 10; dy < p.y + p.height; dy += 20) {
            ctx.beginPath();
            ctx.moveTo(p.x, dy);
            ctx.lineTo(p.x + p.width, dy + 10);
            ctx.stroke();
          }
        } else if (p.type === "hurdle") {
          // Bright Electric Purple threat block profiles
          ctx.fillStyle = "#a855f7";
          ctx.shadowBlur = 12;
          ctx.shadowColor = "#a855f7";
          ctx.fillRect(p.x, p.y, p.width, p.height);
        } else if (p.type === "glowing") {
          // Bright Cyber Cyan floating structural nodes
          ctx.fillStyle = "#06b6d4";
          ctx.shadowBlur = 15;
          ctx.shadowColor = "#06b6d4";
          ctx.fillRect(p.x, p.y, p.width, p.height);
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(p.x + 3, p.y + 3, p.width - 6, 2);
        } else {
          // Clean standard concrete borders
          ctx.fillStyle = "#1e293b";
          ctx.strokeStyle = "rgba(226, 232, 240, 0.4)";
          ctx.lineWidth = 1;
          ctx.fillRect(p.x, p.y, p.width, p.height);
          ctx.strokeRect(p.x, p.y, p.width, p.height);
        }
        ctx.restore();
      });

      // Draw active particles engine
      particlesRef.current.forEach((pt) => {
        ctx.save();
        ctx.fillStyle = pt.color;
        ctx.globalAlpha = pt.life / pt.maxLife;
        ctx.shadowBlur = pt.size * 2;
        ctx.shadowColor = pt.color;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });

      // Draw opponents synchronized live
      const opponents = opponentsRef.current;
      for (const id in opponents) {
        const o = opponents[id];
        drawCharacter(ctx, o.x, o.y, 20, o.isSliding ? 22 : 42, o.colorIndex, o.username, o.vx, o.isSliding);
      }

      // Draw local self character element
      const lp = localPlayerRef.current;
      drawCharacter(ctx, lp.x, lp.y, lp.width, lp.height, lp.colorIndex, "YOU", lp.vx, lp.isSliding);

      ctx.restore(); // Undo camera translation matrices offset
    };

    // Draw high quality aesthetic check checker finish gate banner
    const drawFinishGate = (ctx: CanvasRenderingContext2D) => {
      const fx = 3000;
      const fWidth = 100;
      
      ctx.save();
      // Side Pillar Columns
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(fx, 50, 15, 380);
      ctx.fillRect(fx + fWidth - 15, 50, 15, 380);

      // Golden Arch overlay decoration
      ctx.fillStyle = "#eab308";
      ctx.shadowBlur = 15;
      ctx.shadowColor = "#eab308";
      ctx.fillRect(fx - 10, 50, fWidth + 20, 20);

      // Checkerboard Finish Banner
      const rows = 4;
      const cols = 15;
      const cellW = fWidth / cols;
      const cellH = 30 / rows;
      
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          ctx.fillStyle = (r + c) % 2 === 0 ? "#ffffff" : "#000000";
          ctx.fillRect(fx + c * cellW, 80 + r * cellH, cellW, cellH);
        }
      }

      // Labeled "FINISH LINE" Banner text
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 14px 'JetBrains Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText("FINISH RACE", fx + fWidth / 2, 130);
      ctx.restore();
    };

    // Draw modular cartoon neon style character models
    const drawCharacter = (
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      width: number,
      height: number,
      colorIndex: number,
      labelName: string,
      vx: number,
      isSliding: boolean
    ) => {
      const neonColor = GAME_COLORS[colorIndex];
      ctx.save();

      // Shadow glow trail
      ctx.shadowBlur = 14;
      ctx.shadowColor = neonColor;
      
      // Dynamic color overlays
      ctx.fillStyle = neonColor;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;

      // Draw character chassis body
      if (isSliding) {
        // Flattened capsule pill for sliding layout
        roundRect(ctx, x, y, width, height, 8, true, true);
        
        // Draw neon kinetic visor (facing direction offsets)
        ctx.fillStyle = "#ffffff";
        const visorOffset = vx >= 0 ? 10 : 2;
        ctx.fillRect(x + visorOffset, y + 4, 8, 4);
      } else {
        // Standing model layout capsule pill
        roundRect(ctx, x, y, width, height, 6, true, true);
        
        // Visor glow track
        ctx.fillStyle = "#ffffff";
        const visorOffset = vx >= 0 ? 10 : 2;
        ctx.fillRect(x + visorOffset, y + 8, 8, 5);

        // Runner torso dynamic stripe
        ctx.fillStyle = "rgba(0,0,0,0.4)";
        ctx.fillRect(x + 4, y + 20, width - 8, 4);
      }

      // Draw aesthetic text bubble with username
      ctx.restore();
      ctx.save();
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 11px 'Inter', sans-serif";
      ctx.textAlign = "center";
      ctx.shadowBlur = 4;
      ctx.shadowColor = "#000000";
      
      const label = labelName === "YOU" ? `${myUsername} (YOU)` : labelName;
      ctx.fillText(label, x + width / 2, y - 10);
      ctx.restore();
    };

    // Canvas helper class for rounded rectangles drawing
    const roundRect = (
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      width: number,
      height: number,
      radius: number,
      fill: boolean,
      stroke: boolean
    ) => {
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + width - radius, y);
      ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
      ctx.lineTo(x + width, y + height - radius);
      ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
      ctx.lineTo(x + radius, y + height);
      ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
      if (fill) ctx.fill();
      if (stroke) ctx.stroke();
    };

    // Initialize animation loops
    animationFrameId = requestAnimationFrame(gameLoop);
    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [gameStatus, cameraX, players, myUsername, socket, soundEnabled, onFinishRace]);

  return (
    <div className="w-full h-full flex flex-col bg-[#020617] font-sans text-slate-100 selection:bg-cyan-500 rounded-2xl overflow-hidden shadow-2xl border border-slate-800/80">
      {/* Top dashboard controls status area */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 bg-[#0b1329]/60 backdrop-blur-md border-b border-slate-800">
        <div className="flex items-center gap-2 md:gap-4">
          <div className="flex items-center gap-1.5 text-xs font-mono font-bold tracking-wider text-cyan-400 bg-cyan-950/30 px-3 py-1.5 rounded-full border border-cyan-900/30">
            <Shield className="w-3.5 h-3.5" />
            <span>GATE NODE: {roomId}</span>
          </div>
          <div className="flex -space-x-1 items-center bg-slate-950/40 px-2.5 py-1.5 rounded-full border border-slate-800">
            {players.map((p, idx) => (
              <span
                key={p.socketId}
                style={{ borderColor: GAME_COLORS[p.colorIndex] }}
                className="w-6 h-6 flex items-center justify-center text-[10px] font-mono font-bold rounded-full bg-slate-900 border-2"
                title={p.username}
              >
                {p.username.charAt(0).toUpperCase()}
              </span>
            ))}
            <span className="text-[10px] font-mono text-slate-500 ml-2 whitespace-nowrap hidden sm:inline-block">
              (Live: {players.length}/3)
            </span>
          </div>
        </div>

        {/* Display progress dashboard */}
        {gameStatus === "racing" && (
          <div className="flex items-center gap-3 text-[11px] font-mono text-slate-400">
            <span className="tracking-widest text-[#222]">DEPART</span>
            <div className="relative w-24 md:w-52 h-2.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800/80">
              <div
                style={{
                  width: `${Math.min(100, (localPlayerRef.current.x / 3000) * 100)}%`,
                  backgroundColor: GAME_COLORS[localPlayerRef.current.colorIndex],
                }}
                className="h-full rounded-full transition-all duration-75 shadow-[0_0_8px_rgba(34,197,94,0.5)]"
              />
            </div>
            <span className="text-yellow-400 font-extrabold tracking-widest text-shadow-glow">ARRIVE</span>
          </div>
        )}

        {/* Interactive sound state controller */}
        <button
          onClick={() => setSoundEnabled((prev) => !prev)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-mono font-bold tracking-widest transition-all border cursor-pointer ${
            soundEnabled
              ? "bg-cyan-500/10 text-cyan-400 border-cyan-500/20 hover:bg-cyan-500/25"
              : "bg-slate-950/40 text-slate-600 border-slate-850 hover:bg-slate-900"
          }`}
        >
          <Volume2 className="w-3.5 h-3.5" />
          <span>AUDIO {soundEnabled ? "ON" : "OFF"}</span>
        </button>
      </div>

      {/* Primary HTML5 Interactive Racing Space Canvas */}
      <div ref={containerRef} className="relative flex-1 bg-slate-950 flex flex-col justify-center select-none">
        <canvas ref={canvasRef} className="block w-full focus:outline-none" />

        {/* 5-second match countdown visualizer overlay */}
        {gameStatus === "countdown" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 animate-fade-in backdrop-blur-sm z-30">
            <div className="text-center transform scale-95 animate-pulse">
              <span className="text-[10px] md:text-xs font-mono tracking-widest text-cyan-400 uppercase">
                Synchronizing racing gate systems
              </span>
              <h2 className="text-6xl md:text-8xl font-black font-mono tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-cyan-400 via-rose-400 to-yellow-400 mt-2">
                {countdownSeconds > 0 ? countdownSeconds : "GO!"}
              </h2>
              <p className="text-xs md:text-sm text-slate-400 mt-3 font-mono">
                {countdownSeconds > 0 ? "LOCKDOWN ACHIEVED! RACE STARTS IN..." : "RELEASE RUNNERS!"}
              </p>
            </div>
          </div>
        )}

        {/* Complete visual interactive manual HUD */}
        {gameStatus === "racing" && (
          <div className="absolute bottom-3 left-3 bg-slate-900/90 backdrop-blur border border-slate-800 px-3 py-2 rounded-lg pointer-events-none font-mono text-[10px] md:text-xs text-slate-300 max-w-xs space-y-1 shadow-lg">
            <div className="flex items-center gap-1.5 text-cyan-400 font-bold mb-1">
              <MoveHorizontal className="w-3.5 h-3.5" />
              <span>RUNNER CONTROLS</span>
            </div>
            <div>• Move: <span className="text-slate-100 font-bold">A/D</span> or <span className="text-slate-100 font-bold">◀/▶</span> keys</div>
            <div>• Jump: <span className="text-slate-100 font-bold">Spacebar</span> or <span className="text-slate-100 font-bold">W</span> (Can Wall-climb & Wall-jump!)</div>
            <div>• Slide: <span className="text-slate-100 font-bold">S</span> or <span className="text-slate-100 font-bold">▼</span> (To slide under hurdles!)</div>
          </div>
        )}
      </div>
    </div>
  );
}
