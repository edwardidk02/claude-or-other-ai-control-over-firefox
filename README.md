# Local Browser Bridge — let Claude (or another AI agent) control Firefox

An MCP server plus a Firefox extension that let an AI agent such as **Claude Code** drive your own
Firefox: open tabs, read pages, click, type, fill in forms, take screenshots, upload files and more.
It works like the "Claude in Chrome" experience, but for Firefox, and everything stays on your own
computer (`127.0.0.1`).

> Not affiliated with, endorsed by or sponsored by Anthropic or Mozilla. "Claude" is a trademark of
> Anthropic; it is mentioned here only to say which tools this works with.

```
AI agent (Claude Code, other MCP client)
        │  MCP over stdio
        ▼
server/firefox_mcp.py  ── HTTP long-poll on 127.0.0.1:18765, token-protected ──►  Firefox extension  ──►  tabs
```

## What you see while it works

- The agent only works in its **own orange tab group** called **Claude**. The group title shows the
  task and its state: `⏳ Claude: Search Tame Impala` while working, `✅ Claude: …` when done.
- An **orange glow** around the page and an **orange cursor** show where the agent clicks and types.
  They stay on for the whole task and disappear when the agent reports it is done.
- Tabs and the group are left open after a task, so you can look at the result.

## Safety model

- The agent can only act on tabs **inside its own tab group**. Your other tabs are off-limits; it can
  only take over one of your tabs with `tabs_adopt`, which it is told to use only when you ask.
- The bridge listens on `127.0.0.1` only and every request needs a shared token. Web pages cannot talk
  to it (the custom token header forces a CORS preflight, which the bridge always refuses).
- Network logs redact sensitive query parameters (`token`, `key`, `password`, …).
- The signed extension has **no** "run arbitrary JavaScript" tool (Mozilla does not allow running
  code from outside the add-on).
- Page content is treated as data, never as instructions for the agent.

## Requirements

- Windows, macOS or Linux with **Firefox 142+** (tab groups are needed for the safety model).
- **Python 3.10+** (standard library only, nothing to `pip install`).
- An MCP client, for example [Claude Code](https://claude.com/claude-code).

## Install

1. **Get the code**

   ```
   git clone https://github.com/edwardidk02/claude-or-other-ai-control-over-firefox.git
   cd claude-or-other-ai-control-over-firefox
   ```

2. **Set up the bridge and register it with Claude Code**

   ```
   python install.py
   ```

   This creates a random token in `server/config.json`, registers the MCP server
   `claude-in-firefox` in `~/.claude.json` (user scope, all projects), and prints the token.
   Use `python install.py --no-register` to skip the Claude Code registration.

   Other MCP clients: add a stdio server that runs
   `python /path/to/server/firefox_mcp.py`.

3. **Install the Firefox extension**

   - **Signed (recommended):** download `local-browser-bridge-<version>.xpi` from the
     [Releases](../../releases) page and open it in Firefox (drag it into a window). It stays
     installed across restarts.
   - **Development / unsigned:** open `about:debugging#/runtime/this-firefox` →
     *Load Temporary Add-on…* → choose `extension/manifest.json`. Removed when Firefox restarts.

4. **Connect them**: click the bridge icon in the Firefox toolbar (badge **KEY**), paste the token from
   `server/config.json` and click **Save**. The development build reads the token from
   `extension/config.js` automatically.

5. Start a **new** Claude Code session and ask it to do something in Firefox. The badge shows **ON**
   while a session is connected. In Claude Code, `/mcp` should list `claude-in-firefox` as connected.

| Badge | Meaning |
|---|---|
| **ON** | Connected to an agent session |
| **OFF** | No agent session running (normal when idle) |
| **KEY** | Token missing or wrong — click the icon to set it |

## Tools

| Tool | What it does |
|---|---|
| `browser_status` | Is Firefox connected? Extension version, number of agent tabs |
| `tabs_context` | List the agent's tabs (`all: true` also lists your tab titles) |
| `tabs_create`, `tabs_select`, `tabs_close` | Manage the agent's own tabs |
| `tabs_adopt` | Move one of your tabs into the agent's group (only on request) |
| `set_task` | Set the group title and state (`working` ⏳ / `done` ✅) |
| `navigate` | Go to a URL, or `back` / `forward` / `reload` |
| `read_page`, `find`, `get_page_text` | Read the page as an accessibility tree with `[ref_N]` handles, search it, or get its text |
| `screenshot`, `zoom` | Screenshot (optionally scaled or saved to disk), or a sharp crop of one region |
| `click`, `hover`, `drag` | Left / right / double / triple click, hover, drag and drop — by `ref` or coordinates |
| `type`, `key`, `form_input` | Type text, press keys (`ctrl+a`, `Enter`, …), set form fields |
| `scroll`, `scroll_to` | Scroll the page or bring an element into view |
| `file_upload`, `upload_image` | Put local files or a screenshot into an upload field or drop zone |
| `read_network_requests`, `read_console_messages` | Debugging: requests and console output of the tab |
| `resize_window`, `wait` | Window size, short waits |
| `browser_batch` | Run several of the above in one round trip |
| `javascript` | Run JavaScript in the page — **development build only** |

Several agent sessions can use the bridge at the same time: the first one hosts the bridge on port
18765, the others forward through it, and if it goes away the next one takes over.

## Limitations

- Clicks and typing are **simulated DOM events**: Firefox gives extensions no way to send real OS-level
  input. This works on almost all sites; a few that check `event.isTrusted` will ignore it.
- Extensions cannot run on `about:` pages, `addons.mozilla.org` and other protected pages.
- No GIF recording and no per-site permission prompts (yet).

## For maintainers

- `extension/` is the development build (token from `extension/config.js`, includes the
  `javascript` tool). Load it with `about:debugging`.
- `python build_amo.py` builds `dist/local-browser-bridge-<version>.zip` for addons.mozilla.org:
  neutral name and icon, no token in the package (set on the options page), the `javascript` tool
  stripped, and `data_collection_permissions` declared. It passes `addons-linter` with no errors or
  warnings. Upload it as a self-distributed ("On your own") add-on to get a signed `.xpi`.
- Bump `version` in `extension/manifest.json` before building a new release.
- Never commit `server/config.json`, `extension/config.js` or anything in `dist/` that was built with
  your token (see `.gitignore`).

## License

[MIT](LICENSE)
