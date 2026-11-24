# Checking input: negative numbers, limits, overflow

Everything an action receives comes from the sender, who can send any value the type allows. The ABI checks only that a value fits its type. Whether the value makes sense for your contract is for your code to decide, with `check`. The check that is forgotten most often is the sign of a number.

## Numbers

| Type | What can go wrong |
|---|---|
| `int64_t`, `int32_t` | Can be negative. A negative "price" or "amount" turns a payment into a withdrawal. Check `value > 0` (or `>= 0` when zero is meant). |
| `asset` | Its `amount` is an `int64_t`, so `-5.00000000 WAX` is a valid asset that passes `is_valid()`. Check `quantity.amount > 0` on every amount a user sends, and the symbol with its precision. |
| `uint64_t`, `uint32_t` | Cannot be negative, but a subtraction that goes below zero wraps around to a huge number: `3 - 5` is 18446744073709551614 as `uint64_t`. Compare first, then subtract. |
| `uint8_t`, `uint16_t` | A sum or product is calculated as `int` and stored back into the small type, where it is cut off silently. Calculate in `uint64_t` and check the limit. |
| `float`, `double` | Never use them for money or for anything that must be exact. They round, and a share computed twice may differ in the last unit. Use whole units and divide last. |

An overflow of a plain `int64_t` or `uint64_t` is **not** noticed by the language and does not stop the action. The result is wrong, quietly. The `asset` operators do check (`addition overflow`, `multiplication overflow` and similar, see [Assets and symbols](doc:contract-assets)). For your own counters, check a limit before you add, or calculate in 128 bits (`int128_t`, `uint128_t`) and compare the result to the limit.

## Rules

- **Check the sign and the size of every number a user sends.** Zero, negative, and larger than the largest value you can pay all need a decision.
- **Give every number an upper limit.** A limit of 1000 per action also keeps a sum of 50 such numbers far from an overflow.
- **Compare before you subtract.** `check(balance >= price, "not enough balance")`, then `balance -= price`.
- **Multiply first, then divide, in 128 bits.** `amount * 25 / 1000` rounds down once. Dividing first loses more.
- **Limit the length of text and lists.** A `std::string` or a `std::vector` in a row is paid with RAM by the payer of the row, and a loop over a list costs CPU. Check `text.size()` and `values.size()`.
- **Check that an account exists** with `is_account(name)` when you pay it or store it. A transfer to a name that does not exist is refused by the token contract, but a row that names a missing account stays in your table.
- **Check who is who.** A transfer from an account to the same account, or to the contract, is often not meant. Decide and refuse it.

## Example

A complete contract that keeps a points balance per account. It shows each check once, with the reason in the comment.

```cpp
#include <eosio/eosio.hpp>
#include <eosio/asset.hpp>
#include <vector>
using namespace eosio;

class [[eosio::contract("validator")]] validator : public contract {
public:
  using contract::contract;

  static constexpr symbol POINTS = symbol(symbol_code("PTS"), 2);   // 2 decimals: 1.00 PTS is amount 100
  static constexpr int64_t MAX_AMOUNT = 1000000000;                 // the largest amount of one action, 10000000.00 PTS

  struct [[eosio::table]] balance_row {
    name  owner;
    asset balance;
    uint64_t primary_key() const { return owner.value; }
  };
  typedef multi_index<"balances"_n, balance_row> balances_table;

  struct [[eosio::table]] note_row {
    uint64_t    id;
    name        author;
    std::string text;
    uint64_t primary_key() const { return id; }
  };
  typedef multi_index<"notes"_n, note_row> notes_table;

  // Only the contract account gives points. The same checks apply to the amount.
  [[eosio::action]]
  void grant(name to, asset quantity) {
    require_auth(get_self());
    check(is_account(to), "the receiving account does not exist");
    check_quantity(quantity);

    balances_table balances(get_self(), get_self().value);
    auto it = balances.find(to.value);
    if (it == balances.end()) {
      balances.emplace(get_self(), [&](auto& row) {
        row.owner = to;
        row.balance = quantity;
      });
    } else {
      // asset addition stops the action itself on an overflow or a different symbol.
      balances.modify(it, same_payer, [&](auto& row) { row.balance += quantity; });
    }
  }

  // Moves points between two accounts.
  [[eosio::action]]
  void send(name from, name to, asset quantity) {
    require_auth(from);
    check(from != to, "cannot send to yourself");
    check(is_account(to), "the receiving account does not exist");
    check_quantity(quantity);

    balances_table balances(get_self(), get_self().value);
    auto sender = balances.require_find(from.value, "the sender has no points");
    // Compare before you subtract. A negative quantity was refused above:
    // without that check, "sending" -5 would take points from the receiver.
    check(sender->balance >= quantity, "not enough points");
    balances.modify(sender, same_payer, [&](auto& row) { row.balance -= quantity; });

    auto receiver = balances.find(to.value);
    if (receiver == balances.end()) {
      balances.emplace(from, [&](auto& row) {   // the sender signed, so he may pay the new row
        row.owner = to;
        row.balance = quantity;
      });
    } else {
      balances.modify(receiver, same_payer, [&](auto& row) { row.balance += quantity; });
    }
  }

  // Charges a price for a number of items. A count and a price are both user input.
  [[eosio::action]]
  void buy(name buyer, asset price, uint32_t count) {
    require_auth(buyer);
    check_quantity(price);
    check(count > 0 && count <= 1000, "count must be 1 to 1000");

    asset total = price * count;   // stops the action on an overflow
    balances_table balances(get_self(), get_self().value);
    auto it = balances.require_find(buyer.value, "the buyer has no points");
    check(it->balance >= total, "not enough points");
    balances.modify(it, same_payer, [&](auto& row) { row.balance -= total; });
  }

  // A share in percent: multiply first, in 128 bits, then divide. Rounds down.
  [[eosio::action]]
  void share(asset total, uint8_t percent) {
    check_quantity(total);
    check(percent <= 100, "percent must be 0 to 100");   // an unsigned number can still be too large
    int64_t part = static_cast<int64_t>(static_cast<int128_t>(total.amount) * percent / 100);
    print("share ", asset(part, POINTS));
  }

  // A list from the user: limit its length, then sum in a wider type.
  [[eosio::action]]
  void sum(std::vector<uint32_t> values) {
    check(values.size() <= 50, "at most 50 values");
    uint64_t total = 0;   // 50 values of 32 bits cannot overflow 64 bits; the list limit is what makes this true
    for (uint32_t v : values) total += v;
    print("sum ", total);
  }

  // Text: the author pays the RAM of the row, so the length is limited for him and for you.
  [[eosio::action]]
  void note(name author, std::string text) {
    require_auth(author);
    check(!text.empty() && text.size() <= 140, "the text must be 1 to 140 bytes");
    notes_table notes(get_self(), get_self().value);
    notes.emplace(author, [&](auto& row) {
      row.id = notes.available_primary_key();
      row.author = author;
      row.text = text;
    });
  }

  // Not subtracting below zero with unsigned numbers.
  [[eosio::action]]
  void left(uint64_t stock, uint64_t wanted) {
    check(wanted <= stock, "not enough stock");   // without this, stock - wanted would wrap to a huge number
    print("left ", stock - wanted);
  }

private:
  static void check_quantity(const asset& quantity) {
    check(quantity.is_valid(), "invalid quantity");
    check(quantity.symbol == POINTS, "the quantity must be in PTS with 2 decimals, for example 1.00 PTS");
    check(quantity.amount > 0, "the quantity must be positive");
    check(quantity.amount <= MAX_AMOUNT, "the quantity is above the limit of one action");
  }
};
```

## How to do it here

1. Build (Ctrl+B) and deploy. On the Contract page choose `grant` with `to` = your account and `quantity` = `100.00 PTS`, Authorization = the contract account, then run it.
2. Choose `send` with `from` = your account, `to` = a second account, `quantity` = `-5.00 PTS`, and press **Simulate**. The result shows the refusal `the quantity must be positive`. Without the check, the same action would have moved points the wrong way.
3. Try `quantity` = `5.0 PTS` (one decimal): the refusal names the precision. Try `20000000.00 PTS`: the refusal names the limit.
4. Choose `left` with `stock` = `3` and `wanted` = `5`: `not enough stock`. Remove the `check` in the code and run it again to see the wrapped number, then put it back.
5. Choose `sum` with `values` = `[1,2,3]`, then with 51 values: `at most 50 values`. See [Run actions](doc:run-actions) and [Simulate and the transaction inspector](doc:simulate-inspector).

## What is needed

- For every number a user sends: its smallest and largest meaningful value, written down before you write the check.

> Note: The sample is not audited and is meant for learning. Read [Before mainnet: a checklist](doc:contract-checklist) before you use a contract with real value.

See also [Assets and symbols](doc:contract-assets), [Accepting tokens safely](doc:contract-accept-tokens) and [Error messages](doc:contract-errors).
