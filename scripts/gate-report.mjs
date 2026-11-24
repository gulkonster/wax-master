// Prints the release check report (Markdown) from a vitest JSON result file and
// fails when a release check suite is missing or did not pass.
import { readFileSync } from 'node:fs'

const GATES = [
  { name: 'Criterion 1: transaction correctness', match: /criterion-1/ },
  { name: 'Criterion 2: approval integrity', match: /criterion-2/ }
]

const results = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const files = results.testResults ?? []
let failed = false
const lines = ['## Release checks', '', '| Check | Suite | Passed | Failed |', '|---|---|---|---|']
for (const gate of GATES) {
  const suites = files.filter((f) => gate.match.test(f.name.replace(/\\/g, '/')))
  if (suites.length === 0) {
    failed = true
    lines.push(`| ${gate.name} | (missing) | 0 | - |`)
    continue
  }
  for (const s of suites) {
    const passed = s.assertionResults.filter((a) => a.status === 'passed').length
    const bad = s.assertionResults.filter((a) => a.status === 'failed').length
    if (bad > 0 || passed === 0) failed = true
    lines.push(`| ${gate.name} | ${s.name.replace(/\\/g, '/').split('/').slice(-2).join('/')} | ${passed} | ${bad} |`)
  }
}
lines.push('', `All tests: ${results.numPassedTests} passed, ${results.numFailedTests} failed.`)
console.log(lines.join('\n'))
if (failed || results.numFailedTests > 0) {
  console.error('Release checks did not pass')
  process.exit(1)
}
