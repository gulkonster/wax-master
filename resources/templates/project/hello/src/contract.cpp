#include <%CONTRACT%.hpp>

void %CLASS%::hi(name user) {
  require_auth(user);
  print("Hello, ", user);
}
