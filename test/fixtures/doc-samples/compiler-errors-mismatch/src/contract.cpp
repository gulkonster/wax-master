#include <%CONTRACT%.hpp>

// Header and source disagree on purpose: the build must fail.
void %CLASS%::hi(name user, std::string text) { print(user, text); }
