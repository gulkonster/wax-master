// The 52 slips of the scripted editor check: one deliberate mistake each on the
// Token template (contract `mytoken`), with what the editor must show for it.
// Places are line:column (both from 1) of the start of the underline in the
// file the mistake was made in, as the window shows them after the filter,
// the place and message modules and the contract checks (stage 32).

export const CONTRACT = 'mytoken'
export const CPP = `src/${CONTRACT}.cpp`
export const HPP = `include/${CONTRACT}.hpp`

export type Severity = 'error' | 'warning' | 'hint'

/** One thing the editor must show. Every field that is given must match. */
export interface Item {
  /** The file the problem is in (a problem inside an included header is placed at its related place). */
  file?: string
  line?: number
  col?: number
  severity?: Severity
  /** Case-insensitive part of the message. */
  text?: string
  /** The text the underline covers. */
  underlined?: string
  code?: string
}

export interface Expect {
  /** Each of these must be present. */
  items?: Item[]
  /** None of these may be present (matched on the file that holds the diagnostic). */
  absent?: Item[]
  /** The highest-numbered error of the edited file is at this place. */
  lastError?: { line: number; col: number }
  /** No error and no warning anywhere (hints do not count). */
  nothing?: boolean
  /** The engine is known to say nothing here (B104); asserted so that a change is noticed. */
  hole?: boolean
}

export interface Case {
  id: string
  what: string
  file: string
  edit: (text: string) => string
  expect: Expect
}

function rep(t: string, a: string, b: string): string {
  if (!t.includes(a)) throw new Error(`not found: ${a}`)
  return t.replace(a, b)
}

type RawCase = Omit<Case, 'expect'>

const RAW: RawCase[] = [
  { id: 'semi-1', what: 'delete ; after require_auth(get_self()) (first statement of create)', file: CPP, edit: (t) => rep(t, 'require_auth(get_self());\n\n  auto sym = maximum_supply.symbol;', 'require_auth(get_self())\n\n  auto sym = maximum_supply.symbol;') },
  { id: 'semi-2', what: 'delete ; after "auto sym = maximum_supply.symbol"', file: CPP, edit: (t) => rep(t, 'auto sym = maximum_supply.symbol;\n  check(sym.is_valid(), "invalid symbol name");\n  check(maximum_supply.is_valid()', 'auto sym = maximum_supply.symbol\n  check(sym.is_valid(), "invalid symbol name");\n  check(maximum_supply.is_valid()') },
  { id: 'semi-3', what: 'delete ; after the class closing brace in the header', file: HPP, edit: (t) => rep(t, 'const name& ram_payer);\n};', 'const name& ram_payer);\n}') },
  { id: 'semi-4', what: 'delete ; after an action declaration in the header', file: HPP, edit: (t) => rep(t, 'void create(const name& issuer, const asset& maximum_supply);', 'void create(const name& issuer, const asset& maximum_supply)') },
  { id: 'semi-5', what: 'delete ; after a table field', file: HPP, edit: (t) => rep(t, 'asset max_supply;', 'asset max_supply') },
  { id: 'brace-1', what: 'delete the closing } of create()', file: CPP, edit: (t) => rep(t, '    s.issuer = issuer;\n  });\n}\n', '    s.issuer = issuer;\n  });\n\n') },
  { id: 'paren-1', what: 'delete a closing )', file: CPP, edit: (t) => rep(t, 'check(maximum_supply.is_valid(), "invalid supply");', 'check(maximum_supply.is_valid(, "invalid supply");') },
  { id: 'quote-1', what: 'delete a closing "', file: CPP, edit: (t) => rep(t, '"invalid supply");', '"invalid supply);') },
  { id: 'inc-1', what: 'include a header that does not exist', file: CPP, edit: (t) => '#include <eosio/nosuch.hpp>\n' + t },
  { id: 'inc-2', what: 'typo in the project header name', file: CPP, edit: (t) => rep(t, '#include <mytoken.hpp>', '#include <mytokn.hpp>') },
  { id: 'inc-3', what: 'remove #include <eosio/asset.hpp> from the header', file: HPP, edit: (t) => rep(t, '#include <eosio/asset.hpp>\n', '') },
  { id: 'inc-4', what: 'remove #include <eosio/eosio.hpp> from the header', file: HPP, edit: (t) => rep(t, '#include <eosio/eosio.hpp>\n', '') },
  { id: 'type-1', what: 'assign an asset to uint64_t', file: CPP, edit: (t) => rep(t, 'auto sym = maximum_supply.symbol;', 'uint64_t wrong = maximum_supply;\n  auto sym = maximum_supply.symbol;') },
  { id: 'type-2', what: 'pass a string where a name is expected', file: CPP, edit: (t) => rep(t, 'require_auth(get_self());', 'require_auth("alice");') },
  { id: 'type-3', what: 'unknown type nam instead of name', file: CPP, edit: (t) => rep(t, 'void mytoken::create(const name& issuer', 'void mytoken::create(const nam& issuer') },
  { id: 'type-4', what: 'asset + int', file: CPP, edit: (t) => rep(t, 'auto sym = maximum_supply.symbol;', 'auto bad = maximum_supply + 1;\n  auto sym = maximum_supply.symbol;') },
  { id: 'type-5', what: 'compare asset with name', file: CPP, edit: (t) => rep(t, 'check(maximum_supply.amount > 0,', 'check(maximum_supply == issuer,') },
  { id: 'name-1', what: 'unknown function chek', file: CPP, edit: (t) => rep(t, 'check(sym.is_valid(), "invalid symbol name");', 'chek(sym.is_valid(), "invalid symbol name");') },
  { id: 'name-2', what: 'unknown function requir_auth', file: CPP, edit: (t) => rep(t, 'require_auth(get_self());', 'requir_auth(get_self());') },
  { id: 'name-3', what: 'unknown variable', file: CPP, edit: (t) => rep(t, 'check(maximum_supply.amount > 0,', 'check(maxsupply.amount > 0,') },
  { id: 'name-4', what: 'unknown member', file: CPP, edit: (t) => rep(t, 'check(maximum_supply.amount > 0,', 'check(maximum_supply.amout > 0,') },
  { id: 'name-5', what: 'unknown member inside the emplace lambda (auto& s)', file: CPP, edit: (t) => rep(t, 's.issuer = issuer;', 's.isuer = issuer;') },
  { id: 'name-6', what: 'check() without a message', file: CPP, edit: (t) => rep(t, 'check(sym.is_valid(), "invalid symbol name");', 'check(sym.is_valid());') },
  { id: 'sig-1', what: 'definition has one more parameter than the declaration', file: CPP, edit: (t) => rep(t, 'void mytoken::create(const name& issuer, const asset& maximum_supply) {', 'void mytoken::create(const name& issuer, const asset& maximum_supply, uint8_t extra) {') },
  { id: 'sig-2', what: 'definition parameter type differs (name instead of const name&... asset by value vs symbol)', file: CPP, edit: (t) => rep(t, 'void mytoken::create(const name& issuer, const asset& maximum_supply) {', 'void mytoken::create(const name& issuer, const symbol& maximum_supply) {') },
  { id: 'sig-3', what: 'action declared but never defined', file: CPP, edit: (t) => rep(t, 'void mytoken::create(', 'void mytoken::creat(') },
  { id: 'attr-1', what: '[[eosio::action]] removed from create', file: HPP, edit: (t) => rep(t, '[[eosio::action]]\n  void create', 'void create') },
  { id: 'attr-2', what: 'typo [[eosio::acton]]', file: HPP, edit: (t) => rep(t, '[[eosio::action]]\n  void create', '[[eosio::acton]]\n  void create') },
  { id: 'attr-3', what: 'typo [[eosio::tabel]]', file: HPP, edit: (t) => rep(t, 'struct [[eosio::table]] account {', 'struct [[eosio::tabel]] account {') },
  { id: 'attr-4', what: 'action name longer than 12 characters', file: HPP, edit: (t) => rep(t, 'void create(const name& issuer, const asset& maximum_supply);', 'void create(const name& issuer, const asset& maximum_supply);\n  [[eosio::action]]\n  void averyveryverylongaction(name x) {}') },
  { id: 'attr-5', what: 'action name with an upper-case letter', file: HPP, edit: (t) => rep(t, 'void create(const name& issuer, const asset& maximum_supply);', 'void create(const name& issuer, const asset& maximum_supply);\n  [[eosio::action]]\n  void doThing(name x) {}') },
  { id: 'mi-1', what: 'typo multi_indx', file: HPP, edit: (t) => rep(t, 'typedef eosio::multi_index<"accounts"_n, account> accounts;', 'typedef eosio::multi_indx<"accounts"_n, account> accounts;') },
  { id: 'mi-2', what: 'typo in the row type of a multi_index', file: HPP, edit: (t) => rep(t, 'typedef eosio::multi_index<"accounts"_n, account> accounts;', 'typedef eosio::multi_index<"accounts"_n, acount> accounts;') },
  { id: 'mi-3', what: 'table name longer than 12 characters in "..."_n', file: HPP, edit: (t) => rep(t, '"accounts"_n, account>', '"accountstoolong"_n, account>') },
  { id: 'mi-4', what: 'table name with an invalid character in "..."_n', file: HPP, edit: (t) => rep(t, '"accounts"_n, account>', '"Accounts"_n, account>') },
  { id: 'mi-5', what: 'row struct without primary_key()', file: HPP, edit: (t) => rep(t, '    asset balance;\n    uint64_t primary_key() const { return balance.symbol.code().raw(); }', '    asset balance;') },
  { id: 'mi-6', what: 'find() with a string argument', file: CPP, edit: (t) => rep(t, 'auto existing = statstable.find(sym.code().raw());\n  check(existing == statstable.end(), "token with symbol already exists");', 'auto existing = statstable.find("WAX");\n  check(existing == statstable.end(), "token with symbol already exists");') },
  { id: 'mi-7', what: 'emplace without the payer', file: CPP, edit: (t) => rep(t, 'statstable.emplace(get_self(), [&](auto& s) {\n    s.supply.symbol', 'statstable.emplace([&](auto& s) {\n    s.supply.symbol') },
  { id: 'mi-8', what: 'modify through a const table reference / assign to a const row', file: CPP, edit: (t) => rep(t, 'const auto& st = *existing;\n  check(to == st.issuer', 'const auto& st = *existing;\n  st.supply = quantity;\n  check(to == st.issuer') },
  { id: 'mi-9', what: 'row field of a type that cannot be serialized (a raw pointer)', file: HPP, edit: (t) => rep(t, '    asset balance;\n    uint64_t primary_key', '    asset balance;\n    const char* note;\n    uint64_t primary_key') },
  { id: 'ret-1', what: 'missing return in a non-void function', file: HPP, edit: (t) => rep(t, '    const auto& st = statstable.get(sym_code.raw(), "unknown token");\n    return st.supply;', '    const auto& st = statstable.get(sym_code.raw(), "unknown token");') },
  { id: 'warn-1', what: 'unused variable', file: CPP, edit: (t) => rep(t, 'auto sym = maximum_supply.symbol;', 'int unused_thing = 5;\n  auto sym = maximum_supply.symbol;') },
  { id: 'warn-2', what: 'signed/unsigned comparison', file: CPP, edit: (t) => rep(t, 'check(maximum_supply.amount > 0,', 'check(maximum_supply.amount > memo_len(),').replace('#include <mytoken.hpp>', '#include <mytoken.hpp>\nstatic uint64_t memo_len() { return 3; }') },
  { id: 'sym-1', what: 'symbol with lower-case code', file: CPP, edit: (t) => rep(t, 'auto sym = maximum_supply.symbol;', 'symbol s2("wax", 8);\n  auto sym = maximum_supply.symbol;') },
  { id: 'sym-2', what: 'constexpr name too long: name n = "..."_n', file: CPP, edit: (t) => rep(t, 'auto sym = maximum_supply.symbol;', 'name n2 = "abcdefghijklmnop"_n;\n  auto sym = maximum_supply.symbol;') },
  { id: 'str-1', what: 'std::to_string and string concat into check', file: CPP, edit: (t) => rep(t, 'check(maximum_supply.amount > 0, "max-supply must be positive");', 'check(maximum_supply.amount > 0, "max " + std::to_string(maximum_supply.amount));') },
  { id: 'str-2', what: 'check with a name as the message', file: CPP, edit: (t) => rep(t, 'check(maximum_supply.amount > 0, "max-supply must be positive");', 'check(maximum_supply.amount > 0, issuer);') },
  { id: 'i128-1', what: 'uses uint128_t and a secondary index (must be clean)', file: HPP, edit: (t) => rep(t, '    uint64_t primary_key() const { return supply.symbol.code().raw(); }\n  };', '    uint64_t primary_key() const { return supply.symbol.code().raw(); }\n    uint128_t by_big() const { return (uint128_t(issuer.value) << 64) | supply.amount; }\n    checksum256 by_hash() const { return checksum256(); }\n    double by_d() const { return 1.5; }\n    long double by_ld() const { return 1.5L; }\n  };\n  typedef eosio::multi_index<"stat2"_n, currency_stats, indexed_by<"big"_n, const_mem_fun<currency_stats, uint128_t, &currency_stats::by_big>>, indexed_by<"hash"_n, const_mem_fun<currency_stats, checksum256, &currency_stats::by_hash>>, indexed_by<"dbl"_n, const_mem_fun<currency_stats, double, &currency_stats::by_d>>, indexed_by<"ld"_n, const_mem_fun<currency_stats, long double, &currency_stats::by_ld>>> stats2;\n  static_assert(sizeof(size_t) == 4 && sizeof(void*) == 4 && sizeof(long) == 4, "wasm32 sizes");') },
  { id: 'size-1', what: 'code that depends on size_t being unsigned long vs unsigned int (overload on both)', file: CPP, edit: (t) => rep(t, '#include <mytoken.hpp>', '#include <mytoken.hpp>\nstatic void f(unsigned int) {}\nstatic void f(unsigned long) {}\nstatic void g() { size_t n = 1; f(n); uint32_t a = 1; f(a); uint64_t b = 2; (void)b; std::min<size_t>(n, sizeof(int)); printf("%zu %u", n, a); }') },
  { id: 'exc-1', what: 'try/catch and throw (CDT builds with -fno-exceptions)', file: CPP, edit: (t) => rep(t, 'auto sym = maximum_supply.symbol;', 'try { throw 1; } catch (...) {}\n  auto sym = maximum_supply.symbol;') },
  { id: 'rtti-1', what: 'typeid / dynamic_cast', file: CPP, edit: (t) => rep(t, 'auto sym = maximum_supply.symbol;', 'auto& ti = typeid(issuer);\n  auto sym = maximum_supply.symbol;') },
  { id: 'std-1', what: 'std headers map/set/optional/variant/string_view/tuple use (must be clean)', file: CPP, edit: (t) => rep(t, '#include <mytoken.hpp>', '#include <mytoken.hpp>\n#include <map>\n#include <set>\n#include <optional>\n#include <variant>\n#include <string_view>\n#include <tuple>\n#include <cmath>\n#include <algorithm>\n#include <numeric>\n#include <eosio/system.hpp>\n#include <eosio/crypto.hpp>\n#include <eosio/singleton.hpp>\n#include <eosio/transaction.hpp>\n#include <eosio/binary_extension.hpp>\nstatic uint32_t h() { std::map<name, std::optional<asset>> m; std::set<uint64_t> s{1,2}; std::variant<int, std::string> v = 1; std::string_view sv = "x"; auto t = std::make_tuple(1, sv); (void)t; (void)v; auto now = current_time_point().sec_since_epoch(); auto hsh = sha256("a", 1); (void)hsh; double d = std::sqrt(2.0) + std::pow(2.0, 3); (void)d; binary_extension<uint64_t> be; (void)be.value_or(1); return now + m.size() + std::accumulate(s.begin(), s.end(), 0ull); }') },
]

const CLEAN: Expect = { nothing: true }

const EXPECT: Record<string, Expect> = {
  'semi-1': { items: [{ file: CPP, line: 4, col: 26, severity: 'error', text: "Expected ';' after expression" }] },
  'semi-2': { items: [{ file: CPP, line: 6, col: 34, severity: 'error', text: "Expected ';' at end of declaration" }] },
  'semi-3': { items: [{ file: HPP, line: 128, col: 1, severity: 'error', text: "Expected ';' after class" }] },
  'semi-4': {
    items: [
      { file: HPP, line: 53, col: 19, severity: 'error', text: "Expected ';' at end of declaration list" },
      { file: HPP, line: 104, col: 60, severity: 'error', text: "No member named 'issue' in 'mytoken'" }
    ]
  },
  'semi-5': { items: [{ file: HPP, line: 118, col: 20, severity: 'error', text: "Expected ';' at end of declaration list" }] },
  'brace-1': { items: [{ file: CPP, line: 186, col: 1, severity: 'error', text: "Expected '}'" }], lastError: { line: 186, col: 1 } },
  'paren-1': {
    items: [
      { file: CPP, line: 8, col: 33, severity: 'error', text: 'Expected expression' },
      { file: CPP, line: 186, severity: 'error', text: "Expected '}'" }
    ]
  },
  'quote-1': {
    items: [
      { file: CPP, line: 8, col: 36, severity: 'error', text: 'Expected expression' },
      { file: CPP, line: 186, severity: 'error', text: "Expected '}'" }
    ]
  },
  'inc-1': { items: [{ file: CPP, line: 1, col: 10, severity: 'error', text: "'eosio/nosuch.hpp' file not found", underlined: '<eosio/nosuch.hpp>' }] },
  'inc-2': { items: [{ file: CPP, line: 1, col: 10, severity: 'error', text: "'mytokn.hpp' file not found", underlined: '<mytokn.hpp>' }] },
  'inc-3': { items: [{ file: HPP, line: 49, col: 41, severity: 'error', text: "Unknown type name 'asset'" }] },
  'inc-4': { items: [{ file: HPP, line: 43, col: 55, severity: 'error', text: 'Expected class name' }] },
  'type-1': { items: [{ file: CPP, line: 6, col: 12, severity: 'error', text: "No viable conversion from 'const asset' to 'uint64_t' (aka 'unsigned long long')" }] },
  'type-2': { items: [{ file: CPP, line: 4, col: 3, severity: 'error', text: "No matching function for call to 'require_auth'" }] },
  'type-3': { items: [{ file: CPP, line: 3, col: 28, severity: 'error', text: "Unknown type name 'nam'; did you mean 'name'?" }] },
  'type-4': { items: [{ file: CPP, line: 6, col: 29, severity: 'error', text: "Invalid operands to binary expression ('const asset' and 'int')" }] },
  'type-5': { items: [{ file: CPP, line: 9, col: 24, severity: 'error', text: "Invalid operands to binary expression ('const asset' and 'const name')" }] },
  'name-1': { items: [{ file: CPP, line: 7, col: 3, severity: 'error', text: "Use of undeclared identifier 'chek'; did you mean 'check'?" }] },
  'name-2': { items: [{ file: CPP, line: 4, col: 3, severity: 'error', text: "Use of undeclared identifier 'requir_auth'; did you mean 'require_auth'?" }] },
  'name-3': { items: [{ file: CPP, line: 9, col: 9, severity: 'error', text: "Use of undeclared identifier 'maxsupply'" }] },
  'name-4': { items: [{ file: CPP, line: 9, col: 24, severity: 'error', text: "No member named 'amout' in 'eosio::asset'; did you mean 'amount'?" }] },
  'name-5': { hole: true, nothing: true },
  'name-6': { items: [{ file: CPP, line: 7, col: 3, severity: 'error', text: "No matching function for call to 'check'" }] },
  'sig-1': { items: [{ file: CPP, line: 3, col: 15, severity: 'error', text: "Out-of-line definition of 'create' does not match any declaration in 'mytoken'" }] },
  'sig-2': {
    items: [
      { file: CPP, line: 3, col: 15, severity: 'error', text: "Out-of-line definition of 'create' does not match any declaration in 'mytoken'" },
      { file: CPP, line: 6, col: 29, severity: 'error', text: "Cannot refer to type member 'symbol' in 'const symbol' with '.'" },
      { file: CPP, line: 9, col: 24, severity: 'error', text: "No member named 'amount' in 'eosio::symbol'" }
    ]
  },
  'sig-3': { items: [{ file: CPP, line: 3, col: 15, severity: 'error', text: "Out-of-line definition of 'creat' does not match any declaration in 'mytoken'; did you mean 'create'?" }] },
  'attr-1': CLEAN,
  'attr-2': {
    items: [
      {
        file: HPP,
        line: 49,
        col: 5,
        severity: 'warning',
        underlined: 'eosio::acton',
        text: "Unknown attribute 'eosio::acton': the compiler ignores it, so it has no effect. Did you mean [[eosio::action]]?"
      }
    ]
  },
  'attr-3': {
    items: [
      {
        file: HPP,
        line: 111,
        col: 12,
        severity: 'warning',
        underlined: 'eosio::tabel',
        text: "Unknown attribute 'eosio::tabel': the compiler ignores it, so it has no effect. Did you mean [[eosio::table]]?"
      }
    ]
  },
  'attr-4': { items: [{ file: HPP, line: 52, severity: 'error', underlined: 'averyveryverylongaction', text: "Action name 'averyveryverylongaction' is not valid: it has 23 characters." }] },
  'attr-5': { items: [{ file: HPP, line: 52, severity: 'error', underlined: 'doThing', text: "Action name 'doThing' is not valid: 'T' is not allowed." }] },
  'mi-1': { items: [{ file: HPP, line: 123, col: 18, severity: 'error', text: "No template named 'multi_indx' in namespace 'eosio'; did you mean 'multi_index'?" }] },
  'mi-2': { items: [{ file: HPP, line: 123, col: 44, severity: 'error', text: "Unknown type name 'acount'; did you mean 'account'?" }] },
  'mi-3': {
    items: [{ file: HPP, line: 123, col: 30, severity: 'error', underlined: '"accountstoolong"_n', text: '"accountstoolong"_n is not a valid name: it has 15 characters.' }],
    absent: [{ file: HPP, code: 'constexpr_var_requires_const_init' }, { file: HPP, code: 'expr_not_cce' }]
  },
  'mi-4': {
    items: [{ file: HPP, line: 123, col: 30, severity: 'error', underlined: '"Accounts"_n', text: `"Accounts"_n is not a valid name: 'A' is not allowed.` }],
    absent: [{ file: HPP, code: 'constexpr_var_requires_const_init' }, { file: HPP, code: 'expr_not_cce' }]
  },
  'mi-5': { items: [{ file: HPP, line: 95, col: 14, severity: 'error', text: "No member named 'primary_key' in 'mytoken::account'" }] },
  'mi-6': { hole: true, nothing: true },
  'mi-7': { items: [{ file: CPP, line: 15, col: 3, severity: 'error', text: "No matching member function for call to 'emplace'" }] },
  'mi-8': { items: [{ file: CPP, line: 31, col: 13, severity: 'error', text: "No viable overloaded '='" }] },
  'mi-9': { hole: true, nothing: true },
  'ret-1': { items: [{ file: HPP, line: 90, col: 3, severity: 'warning', text: 'Non-void function does not return a value' }] },
  'warn-1': CLEAN,
  'warn-2': CLEAN,
  'sym-1': CLEAN,
  'sym-2': {
    items: [{ file: CPP, line: 6, severity: 'error', underlined: '"abcdefghijklmnop"_n', text: '"abcdefghijklmnop"_n is not a valid name: it has 16 characters.' }],
    absent: [{ file: CPP, code: 'constexpr_var_requires_const_init' }, { file: CPP, code: 'expr_not_cce' }]
  },
  'str-1': CLEAN,
  'str-2': { items: [{ file: CPP, line: 9, col: 3, severity: 'error', text: "No matching function for call to 'check'" }] },
  'i128-1': CLEAN,
  'size-1': CLEAN,
  'exc-1': {
    items: [
      { file: CPP, line: 6, col: 9, severity: 'error', text: "Cannot use 'throw' with exceptions disabled" },
      { file: CPP, line: 6, col: 3, severity: 'error', text: "Cannot use 'try' with exceptions disabled" }
    ]
  },
  'rtti-1': { items: [{ file: CPP, line: 6, col: 14, severity: 'error', text: 'Use of typeid requires -frtti' }] },
  'std-1': {
    items: [
      {
        file: CPP,
        line: 16,
        col: 390,
        severity: 'error',
        text: "Non-const lvalue reference to type 'unsigned long long' cannot bind to a value of unrelated type 'int'"
      }
    ]
  }
}

export const CASES: Case[] = RAW.map((c) => {
  const expect = EXPECT[c.id]
  if (!expect) throw new Error(`no expectation for case ${c.id}`)
  return { ...c, expect }
})

if (CASES.length !== 52 || Object.keys(EXPECT).length !== 52) throw new Error('the editor check holds 52 cases')
