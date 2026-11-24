# Code signing policy

WAX Master installers are currently not code-signed. This page describes how releases are made and how signing will be added.

## Releases today

- Release installers are built only by the public GitHub Actions workflow `.github/workflows/release.yml`, from a version tag in this repository.
- The workflow runs the full test suite, including the release checks, before building.
- GitHub creates a build-provenance attestation for the exact installer file; anyone can check it with `gh attestation verify <file> -R gulkonster/wax-master`.
- `SHA256SUMS.txt` is published with every release.

## Planned signing

The project intends to apply to the SignPath Foundation for free code signing of open-source software. Under that program:

- Only installers built by the release workflow from this repository are submitted for signing.
- Signing requests are approved by the maintainer.
- The maintainer's GitHub account uses two-factor authentication.

## Roles

| Role | Person |
|---|---|
| Maintainer, release approver | gulkonster |

## Privacy

The app sends no telemetry. It contacts only the chain endpoints the user selects, the GitHub Releases API for the update notice (can be turned off), the WAX Testnet faucet when the user presses Create Testnet Account or Request test tokens, and pages the user opens.
