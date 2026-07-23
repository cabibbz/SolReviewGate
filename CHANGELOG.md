# Changelog

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
