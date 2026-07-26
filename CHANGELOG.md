# Changelog

## Unreleased

### Added

* `/solute` submits the request Claude was given for an independent parallel answer that runs without approval, returns nothing to the session, and is readable only in the PWA
* Answering policy and output schema for parallel packets, separate from the review policy
* Runs recorded before protocol fingerprinting are excluded from lab statistics and reported separately, so a protocol is never compared against records that have no protocol
* With a comparison set configured, running it is the primary approval action, and a single review becomes the secondary option
* Approval screen states what approving will do: one review released automatically, or the named configurations that will run with a choice to follow, with a link to set up several models when none are configured
* Comparison summary on the selection screen: agreement across candidates, a model against verdict and confidence table, and which sources each candidate cited
* `Models at once` control that sets how many configurations one approval runs, and a model picker on each comparison slot
* Decision first phone layout: the PWA opens on the packet or response that is waiting, with history, lab, storage, and clients behind one menu
* Packet reading, technical records, and full candidate responses collapse behind disclosures on the phone
* Running build identifier in `/api/health` and in the PWA menu, so the deployed version is visible from the phone
* `Deploy` workflow that verifies and deploys production from GitHub, on every push to `main` and on demand, so a release needs no local clone
* Run configuration panel in the PWA Lab view for the reviewing model, reasoning effort, and alignment protocol
* Signed `/api/admin/settings` route that reads and stores the review configuration
* Selectable alignment protocols: baseline, a neutral control with no disposition guidance, and a strict citation protocol
* Optional `SOL_MODEL_CHOICES` list of extra model ids offered in the PWA picker
* Comparison sets of up to six configurations, run as separate candidates for one packet
* `AWAITING_SELECTION` state and a phone selection step that releases one candidate or nothing
* Per candidate transcript, response, outcome, and fingerprint in the review detail view
* Repeat runs of a retained packet under another configuration, recorded as phone only research
* Release rate matrix by model and protocol in the Alignment Lab, counted per model run

### Fixed

* The suggested model list contained ids the Codex CLI does not accept, including `gpt-5.6` and `gpt-5.6-codex`. It now lists the real ids: `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.3-codex`, and `gpt-5.2-codex`
* A model the Codex CLI cannot resolve is now recorded as `MODEL_UNAVAILABLE` and shown as "Model not available to this account", instead of a generic worker rejection
* Every comparison slot now has its own protocol and reasoning effort picker, so changing the active protocol no longer leaves existing slots on the protocol they were created with, with `Match protocol and effort above` to align them in one tap

* A candidate could be started twice when the approval request and the phone's polling reached it together, which failed the run with `INVALID_STATE` and `START_FAILED` seconds after approval. Starting a candidate now requires an atomic claim, and losing the job transition to another path no longer marks the run failed

### Changed

* A review records the model, reasoning effort, protocol version, and policy hash chosen for it rather than the deployment environment values
* `SOL_MODEL`, `SOL_REASONING`, and `SOL_PROTOCOL_VERSION` are now defaults for a deployment that has never been configured from the phone
* A configuration change applies to the next approved packet, so a running review keeps the configuration it started with
* Default job lifetime raised to one hour and the client wait raised to match, so a comparison set and an operator decision fit inside one review
* The Alignment Lab counts every model run rather than one per packet

### Security

* Model ids are pattern checked so a selection cannot introduce a Codex command line flag, and reasoning efforts are restricted to a fixed list
* Protocol selections resolve through a server side catalog instead of a submitted file path
* Reading or changing the run configuration requires the paired phone signature
* A packet is answered exactly once, and only a candidate that passed every release check can be selected
* A run queued after a packet was answered can never become the client answer
* Unselected candidates, their transcripts, and their responses stay in the authenticated PWA

## 3.0.1

Released July 23, 2026.

* Migrates recognized legacy `/sol` command files after the new personal skill is installed
* Removes the recognized legacy client shim and payload so two implementations cannot compete
* Leaves unrelated command files untouched unless all legacy Sol Review markers match

## 3.0.0

Released July 23, 2026.

### Added

* Read only public PWA demonstration at `/demo`
* Named Claude client registration, activity, and independent revocation
* Personal `/sol` skill installer for Windows, macOS, and Linux
* Downloadable Windows setup package with a visible installer and remover
* Versioned release packages and SHA 256 checksums
* Claude Code plugin marketplace package
* User supplied microscope branding throughout the PWA and repository

### Changed

* Public visitors to a paired deployment are directed to the safe demo
* Installer downloads are pinned to the matching release tag
* Release and verification workflows use a fixed npm version

### Security

* A public demo cannot pair, connect an account, create clients, submit packets, or read private records
* Each self hosted deployment has its own phone key, Codex connection, encrypted store, and client credentials
* Each Claude computer can use a separate credential that can be revoked without disrupting other clients
