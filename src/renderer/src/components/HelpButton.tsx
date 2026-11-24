// Context help: the "?" button of a dialog, page or section, and the
// "Read more" link at the end of an error explanation.

import { openHelp } from '../lib/docs'
import { HELP_TOPICS, type HelpPlace } from '../lib/help-topics'
import { IconHelp } from './Icons'

/** The "?" of a dialog, page or section: opens the topic of that place. */
export function HelpButton({ place }: { place: HelpPlace }): React.JSX.Element {
  return (
    <button type="button" className="icon-btn help-btn" title="Help for this part" aria-label="Help" onClick={() => openHelp(HELP_TOPICS[place])}>
      <IconHelp />
    </button>
  )
}

/** "Read more" at the end of an error explanation. */
export function ReadMore({ place }: { place: HelpPlace }): React.JSX.Element {
  return (
    <button type="button" className="md-link read-more" onClick={() => openHelp(HELP_TOPICS[place])}>
      Read more
    </button>
  )
}
