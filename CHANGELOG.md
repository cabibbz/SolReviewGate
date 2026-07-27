# Changelog

## Unreleased

### Added

* Approval discloses research before consent: both approval surfaces state when the run, or how many of the candidates, will have web search, and that queries composed from the packet can reach a search provider
* `After Every Deploy` checklist in the README: confirm the build stamp, run one real review, and run one researched review when research changed
* The security model recommends pairing a researched candidate with a packet-only one on packets where the verdict matters, since the packet-only run cannot be steered by anything on the web and disagreement between the two is the injection signal

### Changed

* Default job lifetime raised from one hour to four (`SOL_JOB_TTL_SECONDS=14400`), and the client waits four hours to match, so a comparison set of slow candidates plus the operator's reading time no longer silently answers the packet with the terminal response
* The deny hook's reason names the one permitted tool in a research run instead of claiming no tools exist

* A research trace on every run that was allowed to search: how many searches actually left the sandbox and the query text of each, counted from the Codex event stream rather than taken from the review's own account. Shown on the review, on each candidate, and in the fact table
* A review that names external sources with no observed search behind it is called out as such, rather than presented as though the citations were retrieved
* `EXTERNAL SOURCES` renders on the phone, next to the packet evidence the review cites

### Fixed

* A research run can actually search. Every policy opened by forbidding web searches unconditionally, stated the reviewer had no network as a fact of construction, and forbade citing any source not reproduced in the packet — then permitted research twelve paragraphs below. The reviewer obeyed the opening prohibition, so every researched run reported no search. The reviewer's reach is now stated once, in the mode the run is actually in, and a policy that loses a placeholder fails the run instead of shipping a mismatched one
* Turning research on and pressing `Apply` saves it. The dirty check that enables `Apply` never looked at the research field, so the switch could be flipped and the change silently discarded — indistinguishable from a setting that does not work
* A failed service worker registration no longer throws an unhandled error into the page

* Research runs reach the web. The worker asked Codex for `web_search="enabled"`, which is not one of the accepted variants, so `--strict-config` failed the run at configuration load in about a second and no researched review ever ran. The value is now `live`, and a test asserts both branches stay inside the documented set
* A run Codex refuses to configure is recorded as `SANDBOX_CONFIG_REJECTED` rather than `Worker rejected`, so a deployment fault no longer reads like a model or isolation outcome. `MODEL_UNAVAILABLE` and the new code both count as system failures in the lab instead of falling into unclassified

* Both installers install the `/solute` skill. It shipped as a documented command that no installer ever wrote to disk, so `/solute` did not exist after installing. The Windows uninstaller removes it, the release packager verifies it is present in both archives, and a test asserts every skill directory in the repository is installed, packaged, and removed
* The POSIX installer stages the client and both skills in a temporary directory, validates them there, and copies them into place only after every check passes, so a bad download no longer replaces a working installation
* The POSIX installer has test coverage: a successful install against a local server and a rejected install when a skill does not carry its expected name

### Added

* `Let the reviewer research` allows web search inside the isolated sandbox, per configuration and per comparison slot, so the reviewer can establish an external fact and cite it. Shell, file writes, MCP, and patches stay blocked, the deny hook permits only a search tool and only when the run wrote a research marker, and the worker still terminates the run on any other tool event
* `externalSources` in the review schema, rendered under `EXTERNAL SOURCES` and merged with attribution in a combined release
* A researched run records `+research` on its protocol version and carries a different policy hash, so the lab never pools it with a packet-only run

* Every protocol reads the packet as testimony from the assistant under review: a claim about a file, a command, or a test is unverified until an attachment or reproduced output shows it, an attached file outranks any claim about that file, and the reviewer names what it could not verify. Applied evenly to supporting and undercutting material, and expressed in confidence rather than a harsher verdict, with identical wording in all three protocols
* `Attached Paths` is a scored packet section, and a packet with no attached file contents is flagged on the approval screen

* `Send all N combined` merges every gate-passing candidate into one released review. The merge is deterministic and server side: most severe verdict, lowest confidence, every assessment, recommendation, counterargument, and cited source kept and attributed to the reviewer that gave it
* Every policy states that the reviewer has no tools, no shell, no network, and no write access, and that its recommendations must be executable by the assistant under review without a follow up question

* `/sol` declares an `Attached Paths` section and the client reads those files and folders itself, appending their exact contents with a SHA-256 per file, so the reviewer verifies the code rather than a description of it
* Attached content skips credential files, binaries, oversized files, excluded build directories, and anything outside the working directory, redacts credential lines, and reports everything it left out
* The approval screen shows how many files and how many bytes are attached
* Every review policy and the answering policy explain that attached contents are an exact reproduction, remain untrusted data, and should be cited by path when they contradict the packet

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

* Two retired model ids were still being offered. `gpt-5.3-codex` and `gpt-5.2` sunset on 23 July 2026 and are removed, leaving `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`, `gpt-5.4`, and `gpt-5.4-mini`. A test now fails if a retired or invented id reappears
* `xhigh` reasoning effort was missing. Codex accepts `minimal`, `low`, `medium`, `high`, and `xhigh`

* The source overlap named candidates by model alone, so one model run under two protocols was indistinguishable. A candidate is now labelled by whatever actually differs: the model, plus the protocol when a model repeats, plus the effort when a model and protocol pair repeats

* The page jumped back up while reading. The candidate strip scrolled itself into view from an inline `ref` callback, which React re-invokes on every render, so each two second poll dragged the page back to the strip. Only the strip scrolls now, horizontally, and only when the selection changes
* Polling no longer re-renders the page when the server returned the same jobs, review, candidate, storage, clients, or events

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
