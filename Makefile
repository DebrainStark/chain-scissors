CC = gcc
CFLAGS = -Iinclude -Wall -Wextra
SRC = src/main.c src/utils.c
OBJ = $(SRC:.c=.o)
TARGET = my_program

# ── Thru SDK RPS on-chain program ──────────────────────────────────────────
BASEDIR          := $(CURDIR)/build
THRU_C_SDK_DIR   := $(HOME)/.thru/sdk/c/thru-sdk
EXTRA_CPPFLAGS   := -I$(CURDIR)/include
-include $(THRU_C_SDK_DIR)/thru_c_program.mk

# make-bin must be at top level so it can define its own make targets
$(call make-bin,tn_rps_program_c,src/tn_rps_program,,-ltn_sdk)

rps: bin
# ───────────────────────────────────────────────────────────────────────────

all: $(TARGET)

$(TARGET): $(OBJ)
	$(CC) -o $@ $^

%.o: %.c
	$(CC) $(CFLAGS) -c $< -o $@

clean-app:
	rm -f $(OBJ) $(TARGET)
	rm -rf $(BASEDIR)

.PHONY: all rps clean-app