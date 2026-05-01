#ifndef TN_RPS_PROGRAM_H
#define TN_RPS_PROGRAM_H

#include <thru-sdk/c/tn_sdk.h>

/* ─── Error Codes ─── */
#define TN_RPS_ERR_INVALID_DATA_SIZE        (0x2000UL)
#define TN_RPS_ERR_INVALID_INSTRUCTION      (0x2001UL)
#define TN_RPS_ERR_ACCOUNT_CREATE_FAILED    (0x2002UL)
#define TN_RPS_ERR_ACCOUNT_WRITABLE_FAILED  (0x2003UL)
#define TN_RPS_ERR_ACCOUNT_RESIZE_FAILED    (0x2004UL)
#define TN_RPS_ERR_ACCOUNT_ACCESS_FAILED    (0x2005UL)
#define TN_RPS_ERR_INVALID_MOVE             (0x2006UL)

/* ─── Instruction Types ─── */
#define TN_RPS_INSTRUCTION_INIT             (0U)  /* Initialize a new game account */
#define TN_RPS_INSTRUCTION_PLAY             (1U)  /* Play a round */

/* ─── Move Values (Rock-Paper-Scissors-Lizard-Spock) ─── */
#define TN_RPS_MOVE_ROCK                    (0U)
#define TN_RPS_MOVE_PAPER                   (1U)
#define TN_RPS_MOVE_SCISSORS                (2U)
#define TN_RPS_MOVE_LIZARD                  (3U)
#define TN_RPS_MOVE_SPOCK                   (4U)
#define TN_RPS_MOVE_MAX                     (4U)  /* highest valid move index */

/* ─── Outcome Values ─── */
#define TN_RPS_OUTCOME_WIN                  (0U)
#define TN_RPS_OUTCOME_LOSE                 (1U)
#define TN_RPS_OUTCOME_DRAW                 (2U)

/* ─── Init Instruction ─── */
typedef struct __attribute__((packed)) {
    uint instruction_type;                      /* TN_RPS_INSTRUCTION_INIT */
    ushort account_index;
    uchar game_seed[TN_SEED_SIZE];
    uint proof_size;
    /* proof_data follows dynamically */
} tn_rps_init_args_t;

/* ─── Play Instruction ─── */
typedef struct __attribute__((packed)) {
    uint instruction_type;                      /* TN_RPS_INSTRUCTION_PLAY */
    ushort account_index;
    uint player_move;                           /* 0=Rock, 1=Paper, 2=Scissors */
} tn_rps_play_args_t;

/* ─── Game State (stored in account) ─── */
typedef struct __attribute__((packed)) {
    ulong rounds_played;
    ulong player_wins;
    ulong player_losses;
    ulong draws;
    uint  last_player_move;                     /* last move player made */
    uint  last_contract_move;                   /* last move contract made */
    uint  last_outcome;                         /* WIN / LOSE / DRAW */
} tn_rps_game_t;

#endif /* TN_RPS_PROGRAM_H */
