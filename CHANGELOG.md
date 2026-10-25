# Changelog

Versions follow [SemVer](https://semver.org/). From 0.4.0 on release-please
writes the entries from conventional commits; earlier ones follow
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.7.0](https://github.com/aimuzov/thinks-mcp/compare/v0.6.2...v0.7.0) (2026-10-25)


### Features

* store each turn's text once and export a slim copy for a server ([474cd02](https://github.com/aimuzov/thinks-mcp/commit/474cd0278517d169e1f8dbfffbbfa951bddc0a23))
* store each turn's text once and export a slim copy for a server ([96ad945](https://github.com/aimuzov/thinks-mcp/commit/96ad9457f50168fd07cabb80c8e68308231cfbf8))

## [0.6.2](https://github.com/aimuzov/thinks-mcp/compare/v0.6.1...v0.6.2) (2026-10-25)


### Bug Fixes

* keep the hosted server up and the code corpus intact ([2476eb0](https://github.com/aimuzov/thinks-mcp/commit/2476eb0b0016bb0e2e266a8d8cbdc7b9919c7715))

## [0.6.1](https://github.com/aimuzov/thinks-mcp/compare/v0.6.0...v0.6.1) (2026-10-25)


### Bug Fixes

* **deps:** move to infra-mcp-kit 1.0.2 so a bad token gets 401 ([2169009](https://github.com/aimuzov/thinks-mcp/commit/2169009f12255f34c856eebea54a44a1be9eb585))
* **deps:** move to infra-mcp-kit 1.0.2 so a bad token gets 401 ([fdef25a](https://github.com/aimuzov/thinks-mcp/commit/fdef25a9f89bff1aecc488ae4529845538ca556c))

## [0.6.0](https://github.com/aimuzov/thinks-mcp/compare/v0.5.0...v0.6.0) (2026-10-25)


### Features

* move to infra-mcp-kit and the shared MCP standard ([79ac51e](https://github.com/aimuzov/thinks-mcp/commit/79ac51e01b169e00875b598a15ccf45b9fce3486))
* serve the hosted connector on infra-mcp-kit with the Signal pages ([6bb46b2](https://github.com/aimuzov/thinks-mcp/commit/6bb46b2f1a065775560c2d6e12b182d86c8144d7))


### Bug Fixes

* **deps:** take infra-mcp-kit v1.0.1, which installs from GitHub with its build ([d2f8bac](https://github.com/aimuzov/thinks-mcp/commit/d2f8bac560d8918813b72cbfa64b8b61b076ab43))

## [0.5.0](https://github.com/aimuzov/thinks-mcp/compare/v0.4.0...v0.5.0) (2026-10-24)


### Features

* let Claude talk to the owner in the owner's voice ([#4](https://github.com/aimuzov/thinks-mcp/issues/4)) ([2048e82](https://github.com/aimuzov/thinks-mcp/commit/2048e8231b18fc2a1ac9b7f922a1260c37c583b7))

## [0.4.0](https://github.com/aimuzov/thinks-mcp/compare/v0.3.0...v0.4.0) (2026-10-23)


### Features

* serve thinks-mcp as a remote connector with Telegram login ([#2](https://github.com/aimuzov/thinks-mcp/issues/2)) ([e386bc8](https://github.com/aimuzov/thinks-mcp/commit/e386bc8c3c5d0da89147aaed615cc25bc9a8a7aa))

## [0.3.0] — 2026-09-18

### Added

- `THINKS_NEVER_MARKS` declares marks the owner never types, with their
  stand-ins (`—:--,…:...,→:=>,«:",»:"`). `check_as_me` penalises a declared
  mark in every register regardless of its measured share, quoting it in
  context and naming the stand-in; every brief asks for the stand-in. A
  measured finding for the same mark is dropped so it is not charged twice.
- The ellipsis character `…` and the arrow `→` are measured with the other
  typographic marks. They take effect after the corpus is rebuilt.

### Changed

- The server's own Russian strings -- profile, briefs, tool descriptions,
  findings and CLI help -- use straight quotes and a double hyphen instead of
  guillemets and an em dash. Probe labels keep the marks they name.

## [0.2.0] — 2026-09-08

### Added

- Typographic marks (`«»`, `—`, `–`, `“”`, `--`) are measured per register and
  reported in the profile. A mark below 2% of messages counts as foreign:
  `check_as_me` penalises it and briefs ask for a plain hyphen and straight
  quotes instead. The double hyphen is measured but never penalised — in code it
  is how the author writes a dash.
- `THINKS_CODE_HANDWRITTEN_UNTIL` keeps comments written with an assistant out
  of the typography count. `git blame` calls them the owner's, and counting them
  teaches the assistant what the assistant already wrote.

## [0.1.1] — 2026-09-06

### Fixed

- `check_as_me` no longer asserts one author's marker vocabulary: the "foreign
  marker" rule is derived from the code corpus, and stays quiet when there is
  none.
- List and markdown findings, and the matching constraint in briefs, quote the
  share measured in the archive instead of hardcoded numbers, and do not fire
  for an author who does write lists.
- Test files are now type-checked (`tsconfig.test.json`). This caught a
  `Config` fixture without `recentYears`, which silently disabled the recency
  window in the integration test.
- The MCP handshake reports the version from `package.json`.
- The one English error message ("Could not determine the owner id") is in
  Russian like the rest and points at `THINKS_OWNER_ID`.
- `thinks-mcp --help` prints usage to stdout and exits 0.
- `bin` is declared without the `./` prefix: npm 11.19 drops such an entry
  at publish time, which would have shipped the package with no binary.

### Changed

- Published as `@aimuzov/thinks-mcp`. The unscoped `thinks-mcp` stays at 0.1.0
  and is deprecated in favour of the scoped name; the binary is still
  `thinks-mcp`.
- The tarball no longer ships source maps that pointed at files outside the
  package.
- Usage text lists `THINKS_RECENT_YEARS` and `XDG_CONFIG_HOME`.
- README documents every tool parameter and states that the interface is
  Russian.

### Added

- GitHub Actions CI: types, formatting, tests and a build on every push.

## [0.1.0] — 2026-08-29

First release on npm: `build`, `code`, `profile`, `holdout`, `where` and the
MCP server with `write_as_me`, `reply_as_me`, `rephrase_as_me`, `check_as_me`
and `find_my_messages`.

[Unreleased]: https://github.com/aimuzov/thinks-mcp/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/aimuzov/thinks-mcp/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/aimuzov/thinks-mcp/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/aimuzov/thinks-mcp/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/aimuzov/thinks-mcp/releases/tag/v0.1.0
