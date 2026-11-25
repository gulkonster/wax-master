import { describe, expect, it } from 'vitest'
import { cleanDoc, cleanMessage, prettyNames } from '../../src/shared/lsp-messages'
import { nameToUint64 } from '../../src/chain-core/name'

describe('prettyNames', () => {
  it('says the literal operator as a name literal', () => {
    expect(prettyNames("operator\"\"_n<char, 's', 't', 'a', 't'>()")).toBe('"stat"_n')
    expect(prettyNames("operator\"\"_n < char, 's', 't', 'a', 't'>()")).toBe('"stat"_n')
    expect(prettyNames("In instantiation of function template specialization 'operator\"\"_n<char, 'A', 'c'>' requested here")).toBe(
      "In instantiation of function template specialization '\"Ac\"_n' requested here"
    )
    expect(prettyNames("In call to 'operator\"\"_n<char, 'a', 'c', 'c', 'o', 'u', 'n', 't', 's', 't', 'o', 'o', 'l', 'o', 'n', 'g'>()'")).toBe(
      "In call to '\"accountstoolong\"_n'"
    )
  })

  it('decodes the number that opens a table template', () => {
    expect(prettyNames('multi_index<3607749779137757184, mytoken::account>')).toBe('multi_index<"accounts"_n, mytoken::account>')
    expect(prettyNames("In instantiation of template class 'eosio::multi_index<3607749779137757184, mytoken::account>' requested here")).toBe(
      "In instantiation of template class 'eosio::multi_index<\"accounts\"_n, mytoken::account>' requested here"
    )
    expect(prettyNames('Type: `class eosio::multi_index<14289235522390851584, mytoken::currency_stats>`')).toBe(
      'Type: `class eosio::multi_index<"stat"_n, mytoken::currency_stats>`'
    )
  })

  it('agrees with the name codec', () => {
    const n = nameToUint64('stat')
    expect(prettyNames(`singleton<${n}, row>`)).toBe('singleton<"stat"_n, row>')
    expect(prettyNames(`indexed_by<${nameToUint64('byowner')}, f>`)).toBe('indexed_by<"byowner"_n, f>')
    expect(prettyNames(`action_wrapper<${nameToUint64('transfer')}, &t>`)).toBe('action_wrapper<"transfer"_n, &t>')
  })

  it('leaves other numbers and other templates alone', () => {
    expect(prettyNames('multi_index<12345, row>')).toBe('multi_index<12345, row>')
    expect(prettyNames('vector<3607749779137757184>')).toBe('vector<3607749779137757184>')
    expect(prettyNames('multi_index<99999999999999999999, row>')).toBe('multi_index<99999999999999999999, row>')
    expect(prettyNames('plain text')).toBe('plain text')
    expect(prettyNames('')).toBe('')
  })
})

describe('cleanDoc', () => {
  it('cleans the hover of require_auth', () => {
    const raw =
      '### function `require_auth`  \nprovided by `<eosio/action.hpp>`  \n\n---\n→ `void`  \nParameters:  \n- `name n`\n\nVerifies that @ref name exists in the set of provided auths on a action. Fails if not found.  \n@ingroup action  \n@param name - name of the account to be verified  \n\n---\n```cpp\n// In namespace eosio\ninline void require_auth(name n)\n```'
    const out = cleanDoc(raw)
    expect(out).not.toContain('@')
    expect(out).toContain('Verifies that name exists in the set of provided auths on a action. Fails if not found.  \n- `name` - name of the account to be verified  \n\n---')
    expect(out.endsWith('```cpp\n// In namespace eosio\ninline void require_auth(name n)\n```')).toBe(true)
  })

  it('turns @code into a C++ block in the hover of check', () => {
    const raw =
      'Assert if the predicate fails and use the supplied message.  \n@ingroup system  \nExample:  \n@code eosio::check(a == b, "a does not equal b");  \n@endcode  \n\n---\n```cpp\n// In namespace eosio\ninline void check(bool pred, const char *msg)\n```'
    expect(cleanDoc(raw)).toBe(
      'Assert if the predicate fails and use the supplied message.  \nExample:  \n```cpp\neosio::check(a == b, "a does not equal b");\n```\n\n---\n```cpp\n// In namespace eosio\ninline void check(bool pred, const char *msg)\n```'
    )
  })

  it('keeps a multi-line code block and turns the tags of find and emplace', () => {
    const raw =
      'Search for an existing object in a table using its primary key.  \n@ingroup multiindex  \n@param primary - Primary key value of the object  \n@return An iterator to the found object.  \nExample:  \n@code // This assumes the code.  \nvoid myaction() {  \n  auto itr = addresses.find(1);  \n}  \n@endcode  \n@pre A multi index table has been instantiated  \n@post A new object is created  \n@note Careful  \n@warning Slow'
    const out = cleanDoc(raw)
    expect(out).toBe(
      [
        'Search for an existing object in a table using its primary key.  ',
        '- `primary` - Primary key value of the object  ',
        'Returns: An iterator to the found object.  ',
        'Example:  ',
        '```cpp',
        '// This assumes the code.',
        'void myaction() {',
        '  auto itr = addresses.find(1);',
        '}',
        '```',
        'Pre: A multi index table has been instantiated  ',
        'Post: A new object is created  ',
        'Note: Careful  ',
        'Warning: Slow'
      ].join('\n')
    )
  })

  it('handles @brief, groups, @tparam, % marks and a one-line code block', () => {
    expect(cleanDoc('@brief Wraps a %uint64_t to ensure it is a %name.  \n@addtogroup g  \n@{  \n@}  \n@defgroup x y')).toBe(
      'Wraps a uint64_t to ensure it is a name.  '
    )
    expect(cleanDoc('@tparam T - the type\n@param[in] x the value')).toBe('- `T` - the type\n- `x` - the value')
    expect(cleanDoc('See: @code foo(); @endcode done')).toBe('See:  \n```cpp\nfoo();\n```\ndone')
    expect(cleanDoc('100% sure and 50%name')).toBe('100% sure and 50%name')
  })

  it('leaves fenced code and plain text alone', () => {
    const raw = 'Text\n```cpp\n@ingroup keep\n%name\n```\nEnd'
    expect(cleanDoc(raw)).toBe(raw)
    expect(cleanDoc('No marks here.')).toBe('No marks here.')
    expect(cleanDoc('')).toBe('')
  })

  it('closes a code block that never ends', () => {
    expect(cleanDoc('@code\nx = 1;')).toBe('```cpp\nx = 1;\n```')
  })

  it('is stable when applied twice', () => {
    const once = cleanDoc('A @ref name b.  \n@param n - t  \n@return r')
    expect(cleanDoc(once)).toBe(once)
  })
})

describe('cleanMessage', () => {
  it('cuts the fix hint', () => {
    expect(cleanMessage("Expected ';' after expression (fix available)")).toBe("Expected ';' after expression")
    expect(cleanMessage("Unknown type name 'acount'; did you mean 'account'? (fix available)")).toBe("Unknown type name 'acount'; did you mean 'account'?")
  })

  it('cuts the template prefix and raises the first letter', () => {
    expect(cleanMessage("In template: constexpr variable 'x' must be initialized by a constant expression")).toBe(
      "Constexpr variable 'x' must be initialized by a constant expression"
    )
    expect(cleanMessage('In template: no matching function for call to x (fix available)')).toBe('No matching function for call to x')
  })

  it('says the names in the developer words', () => {
    expect(cleanMessage("No member named 'primary_key' in 'mytoken::account'; in 'multi_index<3607749779137757184, mytoken::account>'")).toBe(
      "No member named 'primary_key' in 'mytoken::account'; in 'multi_index<\"accounts\"_n, mytoken::account>'"
    )
  })

  it('leaves a clean message as it is', () => {
    expect(cleanMessage("Use of undeclared identifier 'x'")).toBe("Use of undeclared identifier 'x'")
    expect(cleanMessage('')).toBe('')
  })
})
