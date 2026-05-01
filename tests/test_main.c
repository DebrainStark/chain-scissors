#include <stdio.h>
#include "utils.h"

void test_add() {
    int result = add(2, 3);
    if (result == 5) {
        printf("test_add passed\n");
    } else {
        printf("test_add failed: expected 5, got %d\n", result);
    }
}

void test_subtract() {
    int result = subtract(5, 3);
    if (result == 2) {
        printf("test_subtract passed\n");
    } else {
        printf("test_subtract failed: expected 2, got %d\n", result);
    }
}

int main() {
    test_add();
    test_subtract();
    return 0;
}