# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versions follow [SemVer](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/aimuzov/thinks-mcp/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/aimuzov/thinks-mcp/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/aimuzov/thinks-mcp/releases/tag/v0.1.0
