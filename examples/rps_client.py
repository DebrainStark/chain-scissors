#!/usr/bin/env python3
"""
Rock-Paper-Scissors-Lizard-Spock client for the Thru on-chain RPS program.

Program:  tag4Hp6uRGBwhCHVQ4ixuZX8JiKH6OHRz4VbFKygGJMHtx
Fee payer: taFkmFRiksjlbiMcN0m_NBCqnJ89kIK984C1JjLTTCZxJq
"""

import struct
import subprocess
import sys
import json
import time

# ── Constants ────────────────────────────────────────────────────────────────

PROGRAM         = "tag4Hp6uRGBwhCHVQ4ixuZX8JiKH6OHRz4VbFKygGJMHtx"
FEE_PAYER       = "taFkmFRiksjlbiMcN0m_NBCqnJ89kIK984C1JjLTTCZxJq"

INSTRUCTION_INIT = 0
INSTRUCTION_PLAY = 1

MOVES = {
    "rock":     0,
    "paper":    1,
    "scissors": 2,
    "lizard":   3,
    "spock":    4,
}
MOVE_NAMES  = {v: k.capitalize() for k, v in MOVES.items()}
OUTCOME_NAMES = {0: "WIN", 1: "LOSE", 2: "DRAW"}

SEED_SIZE = 32

# ── Helpers ──────────────────────────────────────────────────────────────────

def seed_to_bytes(seed: str) -> bytes:
    """Zero-pad a UTF-8 seed string to 32 bytes."""
    b = seed.encode("utf-8")
    if len(b) > SEED_SIZE:
        raise ValueError(f"Seed too long ({len(b)} bytes, max {SEED_SIZE})")
    return b.ljust(SEED_SIZE, b"\x00")


def derive_game_address(seed: str) -> str:
    """Derive the on-chain game account address for a given seed."""
    result = subprocess.run(
        ["thru", "program", "derive-address", PROGRAM, seed],
        capture_output=True, text=True
    )
    for line in result.stdout.splitlines():
        if line.startswith("Derived Address:"):
            return line.split(":", 1)[1].strip()
    raise RuntimeError(f"Could not derive address:\n{result.stdout}\n{result.stderr}")


def run_txn(accounts: list[str], instruction_hex: str, retries: int = 100, delay: int = 15) -> dict:
    """Submit a transaction, retrying on network timeouts."""
    args = ["thru", "txn", "execute", "--json", "--timeout", "60"]
    for acc in accounts:
        args += ["--readwrite-accounts", acc]
    args += [PROGRAM, instruction_hex]

    for attempt in range(1, retries + 1):
        print(f"  Submitting transaction (attempt {attempt}/{retries})...", end=" ", flush=True)
        result = subprocess.run(args, capture_output=True, text=True)
        output = result.stdout + result.stderr

        if result.returncode == 0:
            print("OK")
            try:
                return json.loads(result.stdout)
            except json.JSONDecodeError:
                return {"raw": result.stdout}

        if "timeout" in output.lower() or "unavailable" in output.lower():
            print(f"timeout, retrying in {delay}s...")
            time.sleep(delay)
        else:
            print("failed")
            raise RuntimeError(f"Transaction error:\n{output}")

    raise RuntimeError("Max retries exceeded. Network may be down.")


# ── Instruction builders ──────────────────────────────────────────────────────

def build_init(account_index: int, game_seed: str) -> str:
    seed_bytes = seed_to_bytes(game_seed)
    data = (
        struct.pack("<I", INSTRUCTION_INIT) +
        struct.pack("<H", account_index) +
        seed_bytes +
        struct.pack("<I", 0)   # proof_size = 0
    )
    return data.hex()


def build_play(account_index: int, player_move: int) -> str:
    data = (
        struct.pack("<I", INSTRUCTION_PLAY) +
        struct.pack("<H", account_index) +
        struct.pack("<I", player_move)
    )
    return data.hex()


# ── Game state ────────────────────────────────────────────────────────────────

def get_game_state(game_address: str) -> dict | None:
    """Read game account data from the chain."""
    result = subprocess.run(
        ["thru", "getaccountinfo", "--json", game_address],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        return None
    try:
        info = json.loads(result.stdout)
        raw = info.get("data_hex") or info.get("data") or ""
        if not raw:
            return None
        data = bytes.fromhex(raw)
        if len(data) < 44:
            return None
        # tn_rps_game_t layout (packed):
        #   ulong rounds_played   [0:8]
        #   ulong player_wins     [8:16]
        #   ulong player_losses   [16:24]
        #   ulong draws           [24:32]
        #   uint  last_player_move   [32:36]
        #   uint  last_contract_move [36:40]
        #   uint  last_outcome       [40:44]
        return {
            "rounds_played":      struct.unpack_from("<Q", data, 0)[0],
            "player_wins":        struct.unpack_from("<Q", data, 8)[0],
            "player_losses":      struct.unpack_from("<Q", data, 16)[0],
            "draws":              struct.unpack_from("<Q", data, 24)[0],
            "last_player_move":   struct.unpack_from("<I", data, 32)[0],
            "last_contract_move": struct.unpack_from("<I", data, 36)[0],
            "last_outcome":       struct.unpack_from("<I", data, 40)[0],
        }
    except Exception:
        return None


def print_state(state: dict):
    print(f"\n  Rounds played : {state['rounds_played']}")
    print(f"  Wins          : {state['player_wins']}")
    print(f"  Losses        : {state['player_losses']}")
    print(f"  Draws         : {state['draws']}")
    if state["rounds_played"] > 0:
        pm = MOVE_NAMES.get(state["last_player_move"],   str(state["last_player_move"]))
        cm = MOVE_NAMES.get(state["last_contract_move"], str(state["last_contract_move"]))
        oc = OUTCOME_NAMES.get(state["last_outcome"],    str(state["last_outcome"]))
        print(f"  Last round    : You={pm}  Contract={cm}  →  {oc}")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("=" * 55)
    print("  Rock-Paper-Scissors-Lizard-Spock  ·  Thru Network")
    print("=" * 55)

    game_seed = input("\nEnter a game seed (e.g. 'mygame1'): ").strip()
    if not game_seed:
        print("Seed cannot be empty.")
        sys.exit(1)

    print(f"\nDeriving game account address for seed '{game_seed}'...")
    game_address = derive_game_address(game_seed)
    print(f"  Game account: {game_address}")

    # Sort accounts: fee payer + game account (thru txn sort order)
    sort_result = subprocess.run(
        ["thru", "txn", "sort", FEE_PAYER, game_address],
        capture_output=True, text=True
    )
    ordered = sorted(
        [FEE_PAYER, game_address],
        key=lambda a: int([l.split(":")[1].strip() for l in sort_result.stdout.splitlines() if l.startswith(a)][0])
    )
    game_idx = ordered.index(game_address)

    # Check if game account already exists
    existing = get_game_state(game_address)
    if existing:
        print("\nExisting game found:")
        print_state(existing)
        choice = input("\nResume this game? (y/n): ").strip().lower()
        if choice != "y":
            print("Exiting.")
            sys.exit(0)
    else:
        print("\nNo existing game found. Initializing new game...")
        init_hex = build_init(game_idx, game_seed)
        run_txn(ordered, init_hex)
        print("  Game initialized!")

    # Game loop
    move_options = "  " + "  ".join(f"[{k[0].upper()}]{k[1:]}" for k in MOVES)
    print(f"\n{move_options}  [Q]uit\n")

    while True:
        choice = input("Your move: ").strip().lower()

        if choice in ("q", "quit", "exit"):
            print("\nFinal stats:")
            state = get_game_state(game_address)
            if state:
                print_state(state)
            print("\nGoodbye!")
            break

        # Accept full name or first letter
        move = None
        for name, val in MOVES.items():
            if choice == name or choice == name[0]:
                move = val
                break

        if move is None:
            print(f"  Invalid move. Choose: {', '.join(MOVES.keys())} (or first letter)")
            continue

        print(f"  Playing {MOVE_NAMES[move]}...")
        play_hex = build_play(game_idx, move)
        try:
            run_txn(ordered, play_hex)
        except RuntimeError as e:
            print(f"  Error: {e}")
            continue

        state = get_game_state(game_address)
        if state:
            print_state(state)
        print()


if __name__ == "__main__":
    main()
