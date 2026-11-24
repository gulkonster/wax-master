#include <game.hpp>

void game::hi(name user) {
  land_coinconf_t t(LANDS_CONTRACT, LANDS_CONTRACT.value);
  check(t.exists(), "not set");
}
