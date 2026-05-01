#include <stddef.h>
#include <thru-sdk/c/tn_sdk.h>
#include <thru-sdk/c/tn_sdk_syscall.h>
#include "tn_rps_program.h"

/* ─────────────────────────────────────────────
 * Pseudo-random contract move
 * Uses current slot + rounds_played as entropy
 * ───────────────────────────────────────────── */
static uint get_contract_move(ulong rounds_played) {
    ulong slot    = tsdk_get_current_block_ctx()->slot;
    ulong entropy = slot ^ (rounds_played * 0x9e3779b97f4a7c15UL);

    /* Mix bits (splitmix64) */
    entropy ^= (entropy >> 30);
    entropy *= 0xbf58476d1ce4e5b9UL;
    entropy ^= (entropy >> 27);
    entropy *= 0x94d049bb133111ebUL;
    entropy ^= (entropy >> 31);

    return (uint)(entropy % 5);
}

/* ─────────────────────────────────────────────
 * Determine outcome  (Rock-Paper-Scissors-Lizard-Spock)
 * Returns: WIN(0), LOSE(1), DRAW(2)
 *
 * Win table — each move defeats exactly two others:
 *   Rock(0)     crushes  Scissors(2), Lizard(3)
 *   Paper(1)    covers   Rock(0),     Spock(4)
 *   Scissors(2) cuts     Paper(1),    Lizard(3)
 *   Lizard(3)   poisons  Spock(4),    eats Paper(1)
 *   Spock(4)    smashes  Scissors(2), vaporizes Rock(0)
 * ───────────────────────────────────────────── */
static uint determine_outcome(uint player, uint contract) {
    if (player == contract) return TN_RPS_OUTCOME_DRAW;

    /* wins[move] = the two moves it defeats */
    static const uint wins[5][2] = {
        {TN_RPS_MOVE_SCISSORS, TN_RPS_MOVE_LIZARD},   /* Rock     */
        {TN_RPS_MOVE_ROCK,     TN_RPS_MOVE_SPOCK},    /* Paper    */
        {TN_RPS_MOVE_PAPER,    TN_RPS_MOVE_LIZARD},   /* Scissors */
        {TN_RPS_MOVE_SPOCK,    TN_RPS_MOVE_PAPER},    /* Lizard   */
        {TN_RPS_MOVE_SCISSORS, TN_RPS_MOVE_ROCK},     /* Spock    */
    };

    if (contract == wins[player][0] || contract == wins[player][1]) {
        return TN_RPS_OUTCOME_WIN;
    }
    return TN_RPS_OUTCOME_LOSE;
}

/* ─────────────────────────────────────────────
 * INIT: Create and initialize game account
 * ───────────────────────────────────────────── */
static void handle_init(uchar const *instruction_data,
                        ulong instruction_data_sz TSDK_PARAM_UNUSED) {
    tn_rps_init_args_t const *args = (tn_rps_init_args_t const *)instruction_data;
    ushort account_idx = args->account_index;

    uchar const *proof_data = NULL;
    if (args->proof_size > 0) {
        proof_data = instruction_data + sizeof(tn_rps_init_args_t);
    }

    /* Create the game account */
    ulong result = tsys_account_create(account_idx, args->game_seed,
                                       proof_data, args->proof_size);
    if (result != TSDK_SUCCESS) tsdk_revert(TN_RPS_ERR_ACCOUNT_CREATE_FAILED);

    result = tsys_set_account_data_writable(account_idx);
    if (result != TSDK_SUCCESS) tsdk_revert(TN_RPS_ERR_ACCOUNT_WRITABLE_FAILED);

    result = tsys_account_resize(account_idx, sizeof(tn_rps_game_t));
    if (result != TSDK_SUCCESS) tsdk_revert(TN_RPS_ERR_ACCOUNT_RESIZE_FAILED);

    /* Initialize game state to zero */
    void *account_data = tsdk_get_account_data_ptr(account_idx);
    if (account_data == NULL) tsdk_revert(TN_RPS_ERR_ACCOUNT_ACCESS_FAILED);

    tn_rps_game_t *game      = (tn_rps_game_t *)account_data;
    game->rounds_played      = 0UL;
    game->player_wins        = 0UL;
    game->player_losses      = 0UL;
    game->draws              = 0UL;
    game->last_player_move   = 0U;
    game->last_contract_move = 0U;
    game->last_outcome       = TN_RPS_OUTCOME_DRAW;

    tsdk_return(TSDK_SUCCESS);
}

/* ─────────────────────────────────────────────
 * PLAY: Process one round of Rock Paper Scissors
 * ───────────────────────────────────────────── */
static void handle_play(uchar const *instruction_data,
                        ulong instruction_data_sz TSDK_PARAM_UNUSED) {
    tn_rps_play_args_t const *args = (tn_rps_play_args_t const *)instruction_data;
    ushort account_idx = args->account_index;

    /* Validate player move (0–4: Rock/Paper/Scissors/Lizard/Spock) */
    if (args->player_move > TN_RPS_MOVE_MAX) {
        tsdk_revert(TN_RPS_ERR_INVALID_MOVE);
    }

    void *account_data = tsdk_get_account_data_ptr(account_idx);
    if (account_data == NULL) tsdk_revert(TN_RPS_ERR_ACCOUNT_ACCESS_FAILED);

    ulong result = tsys_set_account_data_writable(account_idx);
    if (result != TSDK_SUCCESS) tsdk_revert(TN_RPS_ERR_ACCOUNT_WRITABLE_FAILED);

    tn_rps_game_t *game = (tn_rps_game_t *)account_data;

    /* Get contract move + determine outcome */
    uint contract_move = get_contract_move(game->rounds_played);
    uint outcome       = determine_outcome(args->player_move, contract_move);

    /* Update state */
    game->rounds_played++;
    game->last_player_move   = args->player_move;
    game->last_contract_move = contract_move;
    game->last_outcome       = outcome;

    if      (outcome == TN_RPS_OUTCOME_WIN)  game->player_wins++;
    else if (outcome == TN_RPS_OUTCOME_LOSE) game->player_losses++;
    else                                     game->draws++;

    /* Emit event:
     * [outcome(4), player_move(4), contract_move(4),
     *  rounds(8), wins(8), losses(8), draws(8)] = 44 bytes */
    typedef struct __attribute__((packed)) {
        uint  outcome;
        uint  player_move;
        uint  contract_move;
        ulong rounds_played;
        ulong player_wins;
        ulong player_losses;
        ulong draws;
    } rps_event_t;

    rps_event_t ev;
    ev.outcome       = outcome;
    ev.player_move   = args->player_move;
    ev.contract_move = contract_move;
    ev.rounds_played = game->rounds_played;
    ev.player_wins   = game->player_wins;
    ev.player_losses = game->player_losses;
    ev.draws         = game->draws;

    tsys_emit_event((uchar const *)&ev, sizeof(rps_event_t));

    tsdk_return(TSDK_SUCCESS);
}

/* ─────────────────────────────────────────────
 * ENTRY POINT
 * ───────────────────────────────────────────── */
TSDK_ENTRYPOINT_FN void start(uchar const *instruction_data, ulong instruction_data_sz) {
    if (instruction_data_sz < sizeof(uint)) {
        tsdk_revert(TN_RPS_ERR_INVALID_DATA_SIZE);
    }

    uint const *instruction_type = (uint const *)instruction_data;

    switch (*instruction_type) {
        case TN_RPS_INSTRUCTION_INIT: {
            if (instruction_data_sz < sizeof(tn_rps_init_args_t)) {
                tsdk_revert(TN_RPS_ERR_INVALID_DATA_SIZE);
            }
            tn_rps_init_args_t const *init_args =
                (tn_rps_init_args_t const *)instruction_data;
            ulong expected = sizeof(tn_rps_init_args_t) + init_args->proof_size;
            if (instruction_data_sz != expected) {
                tsdk_revert(TN_RPS_ERR_INVALID_DATA_SIZE);
            }
            handle_init(instruction_data, instruction_data_sz);
            break;
        }

        case TN_RPS_INSTRUCTION_PLAY:
            if (instruction_data_sz != sizeof(tn_rps_play_args_t)) {
                tsdk_revert(TN_RPS_ERR_INVALID_DATA_SIZE);
            }
            handle_play(instruction_data, instruction_data_sz);
            break;

        default:
            tsdk_revert(TN_RPS_ERR_INVALID_INSTRUCTION);
    }

    tsdk_revert(TN_RPS_ERR_INVALID_INSTRUCTION);
}
