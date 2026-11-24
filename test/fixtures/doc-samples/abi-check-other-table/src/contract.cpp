#include <%CONTRACT%.hpp>

void %CLASS%::showcfg(name other) {
  othercontract::config_table cfg(other, other.value);
  print("rows: ", cfg.begin() == cfg.end() ? "none" : "some");
}
