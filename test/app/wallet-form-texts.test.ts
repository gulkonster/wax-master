// Wallet form texts and rules: the weight line of Add key / Add account, the
// stake fields of Create account, and the reads of an account created a moment ago.

import { describe, expect, it } from 'vitest'
import { COMMA_TEXT, stakeProblem, stakeQuantity } from '../../src/shared/wallet'
import {
  addEntryWeightHint,
  markNewAccount,
  NEW_ACCOUNT_READS_MS,
  NEW_ACCOUNT_WAIT_TEXT,
  newAccountRead,
  nextNewAccountRead
} from '../../src/renderer/src/pages/account/wallet-form'

describe('the weight line of a new permission entry', () => {
  it('threshold 1: weight 1 can sign alone', () => {
    expect(addEntryWeightHint('active', 1, 1)).toBe('The threshold of active is 1 and stays as it is. With weight 1 the new entry can sign alone.')
  })
  it('threshold 2: weight 1 cannot sign alone, weight 2 can', () => {
    const one = addEntryWeightHint('multi', 2, 1)
    expect(one).toBe(
      'The threshold of multi is 2 and stays as it is. With weight 1 the new entry cannot sign alone: with the other signers the weights must add up to 2.'
    )
    expect(one).not.toContain('threshold 1')
    expect(addEntryWeightHint('multi', 2, 2)).toBe('The threshold of multi is 2 and stays as it is. With weight 2 the new entry can sign alone.')
  })
  it('no weight or no threshold yet', () => {
    expect(addEntryWeightHint('multi', 2, NaN)).toBe('The threshold of multi is 2 and stays as it is. Enter a weight of 1 or more.')
    expect(addEntryWeightHint('multi', undefined, 1)).toBe('The threshold of multi is not read yet.')
  })
})

describe('the stake fields of Create account', () => {
  it('a bare number is an amount of the core token at its precision', () => {
    expect(stakeQuantity('1', 8, 'WAX')).toBe('1.00000000 WAX')
    expect(stakeQuantity('0.5', 8, 'WAX')).toBe('0.50000000 WAX')
    expect(stakeQuantity(' 0.5 ', 4, 'EOS')).toBe('0.5000 EOS')
  })
  it('the amount with the symbol and an empty field', () => {
    expect(stakeQuantity('1.00000000 WAX', 8, 'WAX')).toBe('1.00000000 WAX')
    expect(stakeQuantity('2 WAX', 8, 'WAX')).toBe('2.00000000 WAX')
    expect(stakeQuantity('', 8, 'WAX')).toBe('0.00000000 WAX')
  })
  it('refuses another symbol, too many decimals, a comma and text', () => {
    expect(stakeQuantity('1 EOS', 8, 'WAX')).toBeNull()
    expect(stakeQuantity('0.123456789', 8, 'WAX')).toBeNull()
    expect(stakeQuantity('1,5', 8, 'WAX')).toBeNull()
    expect(stakeQuantity('abc', 8, 'WAX')).toBeNull()
    expect(stakeProblem('1,5', 8, 'WAX')).toBe(COMMA_TEXT)
    expect(stakeProblem('abc', 8, 'WAX')).toBe('Enter an amount of WAX with at most 8 decimals, for example 1 or 0.5.')
    expect(stakeProblem('1', 8, 'WAX')).toBe('')
  })
})

describe('the reads of an account created a moment ago', () => {
  it('reads again a few times, then shows the failure', () => {
    markNewAccount('newacct11111')
    const waits: number[] = []
    for (let w = nextNewAccountRead('newacct11111'); w !== null; w = nextNewAccountRead('newacct11111')) waits.push(w)
    expect(waits).toEqual([...NEW_ACCOUNT_READS_MS])
    expect(nextNewAccountRead('newacct11111')).toBeNull()
  })
  it('an account not created here shows a failed read at once', () => {
    expect(nextNewAccountRead('other1111111')).toBeNull()
  })
  it('a successful read ends the waiting', () => {
    markNewAccount('newacct22222')
    expect(nextNewAccountRead('newacct22222')).toBe(NEW_ACCOUNT_READS_MS[0])
    newAccountRead('newacct22222')
    expect(nextNewAccountRead('newacct22222')).toBeNull()
    expect(NEW_ACCOUNT_WAIT_TEXT).toBe('The new account is not readable yet; reading again...')
  })
})
