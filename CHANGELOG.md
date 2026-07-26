# Changelog

## Unreleased

### Added

* Run configuration panel in the PWA Lab view for the reviewing model, reasoning effort, and alignment protocol
* Signed `/api/admin/settings` route that reads and stores the review configuration
* Selectable alignment protocols: baseline, a neutral control with no disposition guidance, and a strict citation protocol
* Optional `SOL_MODEL_CHOICES` list of extra model ids offered in the PWA picker

### Changed

* A review records the model, reasoning effort, protocol version, and policy hash chosen for it rather than the deployment environment values
* `SOL_MODEL`, `SOL_REASONING`, and `SOL_PROTOCOL_VERSION` are now defaults for a deployment that has never been configured from the phone
* A configuration change applies to the next approved packet, so a running review keeps the configuration it started with

### Security

* Model ids are pattern checked so a selection cannot introduce a Codex command line flag, and reasoning efforts are restricted to a fixed list
* Protocol selections resolve through a server side catalog instead of a submitted file path
* Reading or changing the run configuration requires the paired phone signature

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
