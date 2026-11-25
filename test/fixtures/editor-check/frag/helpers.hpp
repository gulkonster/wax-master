// A piece of a source file: it is included after the contract header and uses what that header includes.

inline uint64_t doubled(uint64_t value) { return value * 2; }

inline name owner_or(name given, name fallback) { return given.value ? given : fallback; }

inline asset zero_like(const asset& a) { return asset(0, a.symbol); }
