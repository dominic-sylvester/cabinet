# Cabinet and Hermes MCP

Two local stdio servers connect the systems in both directions:

* `dist/index.js` lets Hermes or another MCP client use Cabinet knowledge, handoffs, and agent runs.
* `dist/hermes.js` lets Cabinet's agent CLIs delegate full agent runs to a local Hermes profile.

The Cabinet server calls a token-authenticated `/api/mcp` gateway. This endpoint is an internal bridge protocol, not a Streamable HTTP MCP endpoint. Keep the app and daemon running for Cabinet operations. The Hermes bridge launches detached workers, so a started job continues when its MCP client disconnects. Its output and state stay on disk.

## Setup

From this directory:

```sh
npm ci
npm run build
```

From the repository root, discover cabinets, then create a scoped connection:

```sh
npx tsx scripts/mcp-connect.ts --list
npx tsx scripts/mcp-connect.ts --cabinet investment-brain --provider codex-cli --provider claude-code
```

Repeat `--cabinet` to grant other cabinets. Use `--hermes-home /absolute/profile/path` to select a Hermes profile and `--hermes-command /absolute/path/to/hermes` if its executable is elsewhere. The default profile is `HERMES_HOME`, or `~/.hermes`. The script refuses to overwrite an existing named connection; use `--name NAME` for a separate connection. It registers only the `cabinet-hermes` entry in the explicitly selected CLI environments. Existing unrelated entries are preserved.

The script prints private connection file paths and the Cabinet MCP launch command, without printing credentials. Register that command through Hermes's own CLI in the chosen profile:

```sh
HERMES_HOME=/absolute/profile/path hermes mcp add cabinet \
  --command /absolute/path/to/node \
  --env CABINET_MCP_CONNECTION=/absolute/path/to/cabinet.json \
  --args /absolute/path/to/cabinet/mcps/mcp-cabinet/dist/index.js
```

Accept the discovered tools. Verify with `hermes mcp test cabinet`. Start a new Hermes and Cabinet agent session to discover the tools. If changing a connection in an existing Hermes session, use `/reload-mcp` as well.

This bridge does not install Hermes's `mcp-serve` plugin. That plugin provides messaging access and selected tools, but cannot launch full agent runs. No messaging accounts are exposed by these bridges.

## Cabinet tools

| Tools | Permission |
| --- | --- |
| `cabinet_list`, `cabinet_context`, `page_list`, `page_read`, `knowledge_search`, `agent_list`, `activity_list` | `read` |
| `page_create`, `page_patch` | `write` |
| `task_list`, `task_create`, `task_update` | `tasks` |
| `run_start`, `run_status`, `run_result`, `run_cancel` | `execute` |

All tools take an optional `cabinetPath`, defaulting to the first granted cabinet. Page paths are relative to that cabinet. Writes require explicit `.md` paths. Search is a bounded, literal, case-insensitive scan of Markdown titles/content/paths; the separate wiki MCP remains available for indexed wiki search. Large reads and results support pagination. Hidden content and descendant symlinks are excluded. An explicitly granted cabinet directory may itself be a link.

Mutations require `requestId`. Reuse the same ID and arguments after a timeout. Durable receipts replay completed results and reject changed arguments. A pending receipt after a process crash is deliberately never redispatched: inspect `activity_list` and the existing task/run before deciding what to do. Page edits also require the exact `expectedRevision` returned by `page_read`; conflicts require another read. Gateway page writers serialize their edits, and changes are attributed through Cabinet history. External programs editing the same files do not participate in that gateway lock.

Handoffs appear in Cabinet's existing agent task inbox. Include acceptance criteria and source references in the description. `task_update.result` carries the completion summary and links to saved pages. Runs use Cabinet's existing conversation store, daemon, and agent configuration. `run_result` includes the transcript, summary, and artifact references. A connection can inspect/cancel only runs it started. One active or unresolved delegated run per connection prevents recursive handoffs. Run execution uses the agent's normal runtime permissions; a cabinet content grant is not a filesystem sandbox for that agent.

## Hermes tools

`hermes_run_start` takes `prompt` and `requestId`, immediately returning `runId`. Use `hermes_run_status`, `hermes_run_result`, and `hermes_run_cancel` afterward. Requests are deduplicated on disk across MCP restarts. Cancellation is handled by the worker, using its owned process group. Runs have a configurable wall-clock and turn budget (initially 15 minutes and 60 turns). There is one active delegation at a time. Workers set an inherited delegation-depth marker to prevent Hermes from starting another Hermes job through this bridge. The bridge does not enable `--yolo`, automatic hook approval, direct messaging MCP tools, or automatic messages. Delegated runs retain the selected profile's existing tools and permissions.

Hermes uses its existing profile, tools, model, and credentials, which can incur normal provider costs when a run is requested. Prompts are passed via files and argv arrays, with no shell interpolation. The bridge's output and stderr files are local diagnostics, not uploads.

## Credentials and recovery

Server-side grants and operation receipts live under `<data>/.cabinet-state/mcp`. Only token hashes are stored in grants. Client tokens and Hermes run files live under `~/.cabinet/mcp/<name>` with private file permissions. To revoke Cabinet access, remove its named connection JSON from `.cabinet-state/mcp/connections` and remove the client entry from the relevant CLI. Removing a server entry does not cancel an already running job; cancel it first if needed.

After an abrupt process or machine termination, a `pending` receipt, stale lock, or `starting` run guard may require manual reconciliation. Inspect the corresponding receipt, run metadata, daemon session, and local diagnostics before removing a stale lock or guard. The integration fails closed rather than risking duplicate work. Hermes workers cannot survive a machine restart; their last persisted run state remains available for inspection.

No original Cabinet service, telemetry, or feedback endpoint is used. Recurring schedules, automatic cross-system scheduler synchronization, and a native Hermes runtime adapter are outside this first version.

## Verify

```sh
npm run typecheck
npm run smoke
```

The smoke test uses a fake local Hermes executable and a mock gateway. It exercises the real MCP transports and detached worker without spending provider credits or changing your knowledge base. The root `npm test` includes gateway authentication, grants, retries, path isolation, page revision, and search tests in an isolated data directory.
