// RPS program constants and instruction builders

export const PROGRAM = "tag4Hp6uRGBwhCHVQ4ixuZX8JiKH6OHRz4VbFKygGJMHtx";
export const RPC_URL = "https://grpc-web.alphanet.thruput.org";

export const SEED_SIZE = 32;

export const MOVES = [
  { id: 0, name: "Rock",     emoji: "🪨" },
  { id: 1, name: "Paper",    emoji: "📄" },
  { id: 2, name: "Scissors", emoji: "✂️" },
  { id: 3, name: "Lizard",   emoji: "🦎" },
  { id: 4, name: "Spock",    emoji: "🖖" },
] as const;

export const OUTCOMES: Record<number, string> = { 0: "WIN", 1: "LOSE", 2: "DRAW" };

export interface GameState {
  rounds_played: bigint;
  player_wins: bigint;
  player_losses: bigint;
  draws: bigint;
  last_player_move: number;
  last_contract_move: number;
  last_outcome: number;
}

// ── Instruction builders ──────────────────────────────────────────────────

function seedToBytes(seed: string): Uint8Array {
  const enc = new TextEncoder().encode(seed);
  const out = new Uint8Array(SEED_SIZE);
  out.set(enc.slice(0, SEED_SIZE));
  return out;
}

export function buildInit(accountIndex: number, gameSeed: string): Uint8Array {
  const buf = new ArrayBuffer(4 + 2 + SEED_SIZE + 4);
  const view = new DataView(buf);
  view.setUint32(0, 0, true);               // INSTRUCTION_INIT
  view.setUint16(4, accountIndex, true);    // account_index
  new Uint8Array(buf).set(seedToBytes(gameSeed), 6);
  view.setUint32(6 + SEED_SIZE, 0, true);  // proof_size = 0
  return new Uint8Array(buf);
}

export function buildPlay(accountIndex: number, move: number): Uint8Array {
  const buf = new ArrayBuffer(4 + 2 + 4);
  const view = new DataView(buf);
  view.setUint32(0, 1, true);              // INSTRUCTION_PLAY
  view.setUint16(4, accountIndex, true);   // account_index
  view.setUint32(6, move, true);           // player_move
  return new Uint8Array(buf);
}

// ── Parse game account data ───────────────────────────────────────────────

export function parseGameState(data: Uint8Array): GameState | null {
  if (data.length < 44) return null;
  const view = new DataView(data.buffer, data.byteOffset);
  return {
    rounds_played:      view.getBigUint64(0,  true),
    player_wins:        view.getBigUint64(8,  true),
    player_losses:      view.getBigUint64(16, true),
    draws:              view.getBigUint64(24, true),
    last_player_move:   view.getUint32(32, true),
    last_contract_move: view.getUint32(36, true),
    last_outcome:       view.getUint32(40, true),
  };
}
