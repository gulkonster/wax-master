// A piece of a class body: it is included inside the contract class and uses what the surrounding file declares.

struct [[eosio::table]] note {
  uint64_t id;
  uint64_t primary_key() const { return id; }
};
typedef eosio::multi_index<"notes"_n, note> notes_table;
std::string describe(const note& n);
