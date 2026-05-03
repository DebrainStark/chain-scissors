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
    } catch (e: unknown) {
      // Account not found is expected before init — only surface real errors
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("not found") && !msg.includes("404")) {
        setStatus(`RPC error: ${msg}`); setStatusType("error");
      }
      setGameState(null);
    }
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
    if (!selectedAccount) { setStatus("No account selected — connect your wallet first."); setStatusType("error"); return; }
    if (!gameAddress) { setStatus("Could not derive game address — check the seed."); setStatusType("error"); return; }
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
    if (!selectedAccount) { setStatus("No account selected."); setStatusType("error"); return; }
    if (!gameAddress) { setStatus("Game address not available."); setStatusType("error"); return; }
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
  const { gameAddress, gameState, status, statusType, busy, initGame, playMove } = useRpsGame(gameSeed);
  const shortGameAddr = gameAddress ? `${gameAddress.slice(0, 10)}…${gameAddress.slice(-6)}` : "deriving…";
  const lastOutcome = gameState ? OUTCOMES[gameState.last_outcome] : null;
  const outcomeClass = lastOutcome?.toLowerCase() ?? "";
  const addr = selectedAccount?.address ?? "";

  return (
    <div className="game-screen">

      {/* Account strip */}
      <div className="acct-strip">
        <div className="acct-left">
          <div className="acct-avatar">🎮</div>
          <div>
            <div className="acct-addr">
              {addr ? `${addr.slice(0, 8)}…${addr.slice(-4)}` : "—"}
            </div>
            <div className="acct-game">Seed: <code>{gameSeed}</code></div>
          </div>
        </div>
        <button className="btn-ghost" onClick={onBack}>← Back</button>
      </div>

      {/* Main card */}
      <div className="glass-card">
        <div className="card-header">
          <span className="card-title">
            <span className="card-title-dot" />
            Rock · Paper · Scissors · Lizard · Spock
          </span>
          <div className="net-pill">
            <div className="net-dot" />
            Alphanet
          </div>
        </div>

        <div className="card-body">

          {!gameState ? (
            <div className="no-game">
              <div className="no-game-orb">🎲</div>
              <p className="no-game-text">No game found for this seed.<br/>Create one to start playing on-chain.</p>
              <p className="no-game-text" style={{fontSize:"11px",opacity:0.5}}>Game account: <code>{shortGameAddr}</code></p>
              <button className="btn-primary" onClick={initGame} disabled={busy}>
                {busy ? "Creating…" : "⚡ Create Game"}
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
                <div className={`battle-card ${outcomeClass}`}>
                  <div className="battle-inner">
                    <div className="battle-side">
                      <span className="battle-badge">You</span>
                      <span className="battle-emoji">{MOVES[gameState.last_player_move]?.emoji}</span>
                      <span className="battle-move-name">{MOVES[gameState.last_player_move]?.name}</span>
                    </div>
                    <div className="battle-center">
                      <span className="battle-vs">vs</span>
                      <span className="battle-outcome">{lastOutcome}</span>
                    </div>
                    <div className="battle-side">
                      <span className="battle-badge">Contract</span>
                      <span className="battle-emoji">{MOVES[gameState.last_contract_move]?.emoji}</span>
                      <span className="battle-move-name">{MOVES[gameState.last_contract_move]?.name}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Move picker */}
              <div>
                <div className="section-header">
                  <span className="section-label">Choose your move</span>
                  <span className="round-badge">Round {String(gameState.rounds_played + 1n)}</span>
                </div>
                <div className="move-grid">
                  {MOVES.map((m) => (
                    <button
                      key={m.id}
                      className="move-btn"
                      data-move={m.id}
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
              {busy && <div className="spinner" />}
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
  const { selectedAccount } = useAccounts();
  const [seedInput, setSeedInput] = useState("");
  const [activeSeed, setActiveSeed] = useState<string | null>(null);

  if (!isConnected || !selectedAccount) {
    return (
      <div className="glass-card">
        <div className="connect-screen">
          <div className="connect-hero-emoji">
            <span>🪨</span><span>📄</span><span>✂️</span><span>🦎</span><span>🖖</span>
          </div>
          <h2>Play RPSLS<br/>On-Chain</h2>
          <p className="connect-sub">
            Rock · Paper · Scissors · Lizard · Spock — powered by the Thru Network. Provably fair, on-chain randomness.
          </p>
          <div className="connect-tags">
            <span className="connect-tag">⛓ On-Chain Logic</span>
            <span className="connect-tag">🎲 Provably Fair</span>
            <span className="connect-tag">⚡ Alphanet</span>
          </div>
          {isConnected && !selectedAccount && (
            <p style={{fontSize:"12px",color:"var(--draw)",marginBottom:"-8px"}}>
              ⚠ Wallet connected — select an account to continue
            </p>
          )}
          <ThruAccountSwitcher />
        </div>
      </div>
    );
  }

  if (activeSeed) {
    return <GameBoard gameSeed={activeSeed} onBack={() => setActiveSeed(null)} />;
  }

  return (
    <div className="glass-card">
      <div className="card-header">
        <span className="card-title">
          <span className="card-title-dot" />
          Start a Game
        </span>
        <div className="net-pill">
          <div className="net-dot" />
          Alphanet
        </div>
      </div>
      <div className="card-body">
        <p className="form-hint">
          Your seed creates a unique on-chain game account. Use the same seed to resume a previous game.
        </p>
        <div>
          <div className="form-label">Game Seed</div>
          <div className="input-wrap">
            <input
              className="chain-input"
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
  );
}

// ── Root ──────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <ThruProvider config={{ iframeUrl: "https://wallet.thru.org/embedded", rpcUrl: RPC_URL }}>
      <div className="grid-bg" />
      <div className="app">
        <header className="app-header">
          <div className="brand">
            <div className="brand-icon">🪨</div>
            <div className="brand-text">
              <h1>RPSLS</h1>
              <div className="tagline">on Thru Network</div>
            </div>
          </div>
          <ThruAccountSwitcher />
        </header>
        <Game />
      </div>
    </ThruProvider>
  );
}
