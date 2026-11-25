// An account the node does not know. get_account answers with its own text
// ("unable to retrieve account info (unknown key (boost::tuples::tuple<...>): (0 name))");
// the app says it in one plain sentence instead, the same everywhere.

/** The node's ways of saying that an account is not there. */
const MISSING_ACCOUNT = /unknown key|unknown_key|account_query_exception|does not exist|unable to retrieve account info/i

/** The plain sentence for an account that does not exist on a network. */
export function missingAccountSentence(name: string, network: string): string {
  return `This account does not exist on ${network}: ${name}.`
}

/** True when an error text says the account is not there (as opposed to a failed request). */
export function isMissingAccountText(text: string): boolean {
  return MISSING_ACCOUNT.test(text)
}

/**
 * The plain sentence for a failed account read when the node's text says the
 * account is not there; null for any other failure, which keeps its own text.
 */
export function missingAccountText(errorText: string, name: string, network: string): string | null {
  return isMissingAccountText(errorText) ? missingAccountSentence(name, network) : null
}
