import { useState, useEffect, useCallback } from "react";
import { ThruProvider, useWallet, useAccounts } from "@thru/react-sdk";
import { ThruAccountSwitcher } from "@thru/react-ui";
import { createThruClient, deriveAddress } from "@thru/thru-sdk";
import {
  PROGRAM, RPC_URL, MOVES, OUTCOMES,
  buildInit, buildPlay, parseGameState,
  type GameState,
} from "./rps";
import "./App.css";

// ── Shared RPC client ─────────────────────────────────────────────────────

const thru = createThruClient({ baseUrl: RPC_URL });

// ── Game hook ─────────────────────────────────────────────────────────────

function useRpsGame(gameSeed: string) {
  const { selectedAccount } = useAccounts();
  const { wallet: walletChain } = useWallet();
  const [gameAddress, setGameAddress] = useState<string | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [status, setStatus] = useState<string>("");
  const [statusType, setStatusType] = useState<"info" | "success" | "error">("info");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!gameSeed) { setGameAddress(null); return; }
    try {
      const seedBytes = new TextEncoder().encode(gameSeed.padEnd(32, "\0").slice(0, 32));
      const result = deriveAddress([PROGRAM, seedBytes]);
      setGameAddress(result.address);
    } catch { setGameAddress(null); }
  }, [gameSeed]);

  const fetchState = useCallback(async () => {
    if (!gameAddress) return;
    try {
      const account = await thru.accounts.get(gameAddress);
      const bytes = account.data?.data;
      setGameState(bytes ? parseGameState(bytes) : null);
    } catch { setGameState(null); }
  }, [gameAddress]);

  useEffect(() => { fetchState(); }, [fetchState]);

  const submitTx = useCallback(async (
    buildInstData: (getIndex: (addr: string) => number) => Uint8Array,
    extraRwAccounts: string[],
  ) => {
    if (!selectedAccount || !walletChain) throw new Error("Wallet not connected");
    const signingCtx = await walletChain.getSigningContext();
    const feePayerAddr = signingCtx.feePayerPublicKey;
    const [feePayerAccount, heightSnap, chainId] = await Promise.all([
      thru.accounts.get(feePayerAddr),
      thru.blocks.getBlockHeight(),
      thru.chain.getChainId(),
    ]);
    const nonce = feePayerAccount.meta?.nonce ?? 0n;
    const startSlot = heightSnap.finalized;
    const tx = await thru.transactions.build({
      feePayer: { publicKey: feePayerAddr },
      program: PROGRAM,
      header: { fee: 1n, nonce, startSlot, expiryAfter: 100, chainId },
      accounts: { readWrite: extraRwAccounts },
      instructionData: async ({ getAccountIndex }) =>
        buildInstData((addr) => getAccountIndex(addr)),
    });
    const wireB64 = btoa(String.fromCharCode(...tx.toWire()));
    const signedB64 = await walletChain.signTransaction(wireB64);
    const rawTx = Uint8Array.from(atob(signedB64), (c) => c.charCodeAt(0));
    return thru.transactions.send(rawTx);
  }, [selectedAccount, walletChain]);

  const initGame = useCallback(async () => {
    if (!selectedAccount || !gameAddress) return;
    setBusy(true); setStatus("Initializing game on-chain…"); setStatusType("info");
    try {
      await submitTx((getIndex) => buildInit(getIndex(gameAddress), gameSeed), [gameAddress]);
      setStatus("Game created!"); setStatusType("success");
      await fetchState();
    } catch (e: unknown) {
      setStatus(e instanceof Error ? e.message : String(e)); setStatusType("error");
    } finally { setBusy(false); }
  }, [selectedAccount, gameAddress, gameSeed, submitTx, fetchState]);

  const playMove = useCallback(async (move: number) => {
    if (!selectedAccount || !gameAddress) return;
    setBusy(true); setStatus(`Playing ${MOVES[move].name}…`); setStatusType("info");
    try {
      await submitTx((getIndex) => buildPlay(getIndex(gameAddress), move), [gameAddress]);
      setStatus("Move confirmed!"); setStatusType("success");
      await fetchState();
    } catch (e: unknown) {
      setStatus(e instanceof Error ? e.message : String(e)); setStatusType("error");
    } finally { setBusy(false); }
  }, [selectedAccount, gameAddress, submitTx, fetchState]);

  return { gameAddress, gameState, status, statusType, busy, initGame, playMove };
}

// ── Game Board ────────────────────────────────────────────────────────────

function GameBoard({ gameSeed, onBack }: { gameSeed: string; onBack: () => void }) {
  const { selectedAccount } = useAccounts();
  const { gameState, status, statusType, busy, initGame, playMove } = useRpsGame(gameSeed);
  const lastOutcome = gameState ? OUTCOMES[gameState.last_outcome] : null;
  const addr = selectedAccount?.address ?? "";

  return (
    <div className="game-screen">

      {/* Account strip */}
      <div className="account-strip">
        <div className="account-info">
          <div className="account-avatar" />
          <div>
            <div className="account-addr">
              {addr ? `${addr.slice(0, 8)}…${addr.slice(-4)}` : "—"}
            </div>
            <div className="account-seed">Game: <code>{gameSeed}</code></div>
          </div>
        </div>
        <button className="btn-ghost" onClick={onBack}>← Back</button>
      </div>

      {/* Main card */}
      <div className="card">
        <div className="card-header">
          <span className="card-header-title">🎮 Rock · Paper · Scissors · Lizard · Spock</span>
          <div className="network-badge">
            <div className="network-dot" />
            Alphanet
          </div>
        </div>

        <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {!gameState ? (
            <div className="no-game">
              <div className="no-game-icon">🎲</div>
              <p>No game found for this seed.</p>
              <button className="btn-primary" onClick={initGame} disabled={busy}>
                {busy ? "Creating…" : "Create Game"}
              </button>
            </div>
          ) : (
            <>
              {/* Scoreboard */}
              <div className="scoreboard">
                <div className="score-tile win">
                  <span className="score-num">{String(gameState.player_wins)}</span>
                  <span className="score-label">Wins</span>
                </div>
                <div className="score-tile draw">
                  <span className="score-num">{String(gameState.draws)}</span>
                  <span className="score-label">Draws</span>
                </div>
                <div className="score-tile lose">
                  <span className="score-num">{String(gameState.player_losses)}</span>
                  <span className="score-label">Losses</span>
                </div>
              </div>

              {/* Last round */}
              {gameState.rounds_played > 0n && (
                <div className={`last-round ${lastOutcome?.toLowerCase()}`}>
                  <div className="round-side">
                    <span className="round-label">You</span>
                    <span className="round-emoji">{MOVES[gameState.last_player_move]?.emoji}</span>
                    <span className="round-name">{MOVES[gameState.last_player_move]?.name}</span>
                  </div>
                  <span className="outcome-pill">{lastOutcome}</span>
                  <div className="round-side">
                    <span className="round-label">Contract</span>
                    <span className="round-emoji">{MOVES[gameState.last_contract_move]?.emoji}</span>
                    <span className="round-name">{MOVES[gameState.last_contract_move]?.name}</span>
                  </div>
                </div>
              )}

              {/* Rounds counter */}
              <div className="rounds-counter">
                Round {String(gameState.rounds_played + 1n)}
              </div>

              {/* Move picker */}
              <div>
                <div className="move-picker-label">Choose your move</div>
                <div className="move-grid">
                  {MOVES.map((m) => (
                    <button
                      key={m.id}
                      className="move-btn"
                      onClick={() => playMove(m.id)}
                      disabled={busy}
                      title={m.name}
                    >
                      <span className="move-emoji">{m.emoji}</span>
                      <span className="move-name">{m.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Status */}
          {status && (
            <div className={`status-bar ${statusType}`}>
              {busy && <div className="status-spinner" />}
              {status}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Connect + Seed screens ────────────────────────────────────────────────

function Game() {
  const { isConnected } = useWallet();
  const [seedInput, setSeedInput] = useState("");
  const [activeSeed, setActiveSeed] = useState<string | null>(null);

  if (!isConnected) {
    return (
      <div className="card">
        <div className="connect-screen">
          <div className="connect-fox">🦊</div>
          <h2>Welcome to RPSLS</h2>
          <p>Connect your Thru wallet to start playing Rock-Paper-Scissors-Lizard-Spock on-chain.</p>
          <ThruAccountSwitcher />
        </div>
      </div>
    );
  }

  if (activeSeed) {
    return <GameBoard gameSeed={activeSeed} onBack={() => setActiveSeed(null)} />;
  }

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-header-title">🎮 Start a Game</span>
        <div className="network-badge">
          <div className="network-dot" />
          Alphanet
        </div>
      </div>
      <div className="card-body">
        <div className="seed-screen">
          <p className="hint">Your seed creates a unique on-chain game account. Use the same seed to resume a previous game.</p>
          <div className="input-group">
            <label className="input-label">Game Seed</label>
            <div className="input-row">
              <input
                className="mm-input"
                value={seedInput}
                onChange={(e) => setSeedInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && seedInput.trim() && setActiveSeed(seedInput.trim())}
                placeholder="e.g. mygame1"
                maxLength={31}
              />
              <button
                className="btn-primary"
                disabled={!seedInput.trim()}
                onClick={() => setActiveSeed(seedInput.trim())}
              >
                Play →
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <ThruProvider config={{ iframeUrl: "https://wallet.thru.org/embedded", rpcUrl: RPC_URL }}>
      <div className="app">
        <header className="app-header">
          <div className="header-logo">
            <div className="header-logo-icon">🪨</div>
            <div>
              <h1>RPSLS</h1>
              <div className="subtitle">on Thru Network</div>
            </div>
          </div>
          <ThruAccountSwitcher />
        </header>
        <Game />
      </div>
    </ThruProvider>
  );
}
