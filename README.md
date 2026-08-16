# thinks-mcp

[Русская версия](README.ru.md)

An MCP server that writes, replies and rephrases in your own voice, learned from
a Telegram export and your git history.

The server generates nothing itself and calls no API. It hands the calling model
a **brief**: a measured style profile, real messages of yours picked for the
request, numeric constraints and an output contract. The model writes — Claude
Code, Claude Desktop, whatever you use.

## How it works

Two phases with a SQLite file between them.

**Build** (manual, rare): export → filter → redact → group messages into turns →
measure → index.

**Serve** (the MCP server): tool call → BM25 search over the archive → brief.

The unit of the corpus is a **turn**, not a message: a run of messages sent
within 90 seconds of each other. That is what real chat looks like — a sizeable
share of messages arrive in bursts, a thought split across several short replies
instead of one paragraph. Indexing single messages would teach the opposite.

## Install

Node 24 or newer. The corpus and the search are built on `node:sqlite` with
FTS5, which is stable from that version on.

### Through mise

```bash
mise use -g npm:thinks-mcp
```

### From source

```bash
pnpm i && pnpm build && npm pack && npm i -g ./thinks-mcp-0.1.0.tgz
```

Note that `npm i -g` installs the binary into whichever Node version is active
at that moment. If mise switches versions, `thinks-mcp` disappears from `PATH` —
so in an MCP host config prefer launching through `mise exec` over relying on
the bare command name.

## Building the chat corpus

Export your archive from Telegram: Settings → Advanced → Export Telegram data,
JSON format, uncheck every media type (only the text is used). Then:

```bash
thinks-mcp build ~/Downloads/Telegram\ Desktop/DataExport/result.json
```

Order of magnitude: a few hundred thousand messages take about 15 seconds. The
export is parsed into memory whole, and the peak is roughly six times the file
size — about 2.5 GB for a 400 MB export. If Node runs out of heap, raise it:
`NODE_OPTIONS=--max-old-space-size=8192 thinks-mcp build ...`

Where things live and whether they are built:

```bash
thinks-mcp where
thinks-mcp profile
```

## Building the code corpus

A second, independent corpus: comments from your repositories. It exists for the
job the chat corpus is wrong for — writing comments in code.

```bash
THINKS_CODE_EMAILS="me@personal,me@work" thinks-mcp code ~/Projects/*/ ~/work/repo
```

Authorship is resolved with `git blame`: a block enters the corpus only if more
than half of its lines were written from one of those addresses. Other people's
comments, section rules, commented-out code and tool directives
(`eslint-disable`, `shellcheck source=`) are dropped.

It yields two registers: `code` for inline notes, `jsdoc` for docblocks. They
are measured separately because they are different genres — an inline note is
usually one line, a docblock opens with a summary and continues.

Both corpora share one database without interfering: `build` rebuilds only the
chat registers, `code` only the code ones.

The corpus lives in `~/.config/thinks-mcp/style.db` — next to your config, not
next to the code. Otherwise a package upgrade would take it along with the old
version.

## Connecting

Copy `.mcp.json.example` to `.mcp.json`:

```json
{
  "mcpServers": {
    "thinks": {
      "command": "/opt/homebrew/bin/mise",
      "args": ["exec", "npm:thinks-mcp", "--", "thinks-mcp"]
    }
  }
}
```

While the package is unpublished, run a locally installed binary instead:

```json
{
  "mcpServers": {
    "thinks": {
      "command": "/opt/homebrew/bin/mise",
      "args": ["x", "node@24", "--", "thinks-mcp"]
    }
  }
}
```

The server starts even with no corpus built and says what to do — so a machine
that has not imported an archive yet gets a working server, not a failed one.

## Tools

| Tool | What it does |
|---|---|
| `write_as_me` | brief for writing something from scratch |
| `reply_as_me` | brief for answering an incoming message |
| `rephrase_as_me` | brief for rewriting existing text |
| `check_as_me` | deterministic 0–100 score and a list of deviations |
| `find_my_messages` | search the archive: "how do I usually turn things down" |

Every tool takes a `register`: `dm` for private chat, `group` for group chats,
`longform` for extended writing, `code` for inline comments, `jsdoc` for
docblocks. The profile, the constraints and the search are split by register
because the styles genuinely differ, and `check_as_me` checks different things
for code: line width, markers, filler instead of fact, types in braces.

For comments in code use only `code` and `jsdoc`. The chat registers are
measured on conversation — short replies, colloquial forms, emoji — and in code
they produce somebody else's voice.

There is also `lang` (`ru`/`en`), meaningful for code, where both are used.

`check_as_me` takes an optional `code` argument: the lines the comment sits
above. With it the check also catches comments that restate the code. Its
limitation is real — it compares words, so a Russian comment over English
identifiers cannot be judged and the check stays quiet.

Resources: `style://profile` and `style://profile/{register}`, the profile as
markdown. Prompts: `as-me` and `reply-as-me`.

The loop those prompts set up: get a brief → write → `check_as_me` → rewrite
against the findings until the score is high.

## Recency

Habits drift over a decade of chat history — punctuation, message length,
rhythm. A profile averaged over the whole archive describes neither the person
you are now nor the one you were ten years ago. So:

- the profile and the constraints are measured over the last few years
  (`THINKS_RECENT_YEARS`), with the all-time numbers shown for reference;
- search results are weighted by year, so a recent example wins all else being
  equal. The weight is set so that a decade of age costs about a third of the
  typical BM25 spread in a result set: recency matters, but an irrelevant new
  message does not outrank a relevant old one.

## Privacy

This is a private message archive, so:

- the export and the built index are never committed — the data directory sits
  outside the repository entirely;
- phone numbers, emails and card numbers are removed using Telegram's own entity
  markup — an export guarantees the entities cover the message text exactly —
  plus fallback regexes for anything left untagged;
- chats, senders and repositories are stored under pseudonyms; real names never
  reach the database;
- surnames are scrubbed from message bodies, first names are not: a bare first
  name identifies nobody, and without them every example would read like a
  redacted document;
- proper nouns are excluded from the style profile separately.

Exclude whole chats: `THINKS_CHAT_STOPLIST="Chat one,Chat two"`.

## Commands

```bash
thinks-mcp build <dump.json>    # build the chat corpus
thinks-mcp code <repos...>      # build the comment corpus
thinks-mcp profile jsdoc        # print the profile for a register
thinks-mcp where                # where the index lives
thinks-mcp holdout --answers    # blind quality check
thinks-mcp serve                # same as no arguments
```

In the repository itself:

```bash
mise run check           # types, formatting, tests
pnpm test
pnpm build
```

`holdout` is the blind quality check: at build time 20 real incoming/answer
pairs are held out and kept out of the index. You look at the incoming messages
first, answer them through `reply_as_me`, then compare with what was actually
said.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `THINKS_DATA_DIR` | `~/.config/thinks-mcp` | directory holding the index |
| `THINKS_DUMP` | `<data-dir>/dump.json` | export path, if not passed as an argument |
| `THINKS_DB` | `<data-dir>/style.db` | index file path |
| `THINKS_OWNER_ID` | auto-detected | set if detection picks the wrong person |
| `THINKS_CHAT_STOPLIST` | empty | comma-separated chats to skip |
| `THINKS_CODE_EMAILS` | `git config user.email` | comma-separated git author emails |
| `THINKS_RECENT_YEARS` | `3` | window that counts as "how I write now" |
| `THINKS_BURST_WINDOW` | `90` | burst window in seconds |
| `THINKS_LONGFORM_MIN` | `300` | longform threshold in characters |
| `THINKS_HOLDOUT` | `20` | pairs held out for the blind check |

## Dependencies

`@modelcontextprotocol/sdk` and `zod`, and that is all. Full-text search runs on
FTS5 from Node's built-in `node:sqlite`; the Russian and English stemmers are
written here (`src/search/stem.ts`) because FTS5 tokenises both scripts but
knows no morphology.

## License

MIT
