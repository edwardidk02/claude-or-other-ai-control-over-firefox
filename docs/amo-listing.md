# Texts for the addons.mozilla.org listing

Copy these into the add-on's listing on addons.mozilla.org (Edit Product Page) and into the
version's "Notes for Reviewers".

## Summary (max 250 characters)

Lets a local AI agent such as Claude Code control Firefox through a bridge on 127.0.0.1: open tabs,
read pages, click, type and fill in forms — only in its own tab group. Not affiliated with Anthropic.

## Description

Local Browser Bridge connects Firefox to an AI agent running on your own computer, such as Claude
Code or another MCP client. The agent can open tabs, read pages, click, type, fill in forms, take
screenshots and upload files, so it can do browser tasks for you.

**You stay in control**
- The agent only works in its own orange tab group called "Claude". Your other tabs are off-limits.
- The group title shows what the agent is doing (⏳ while working, ✅ when done), and an orange glow
  and cursor show where it clicks.
- The extension only talks to a program on your own computer (127.0.0.1), protected by a token.
  It sends nothing to the internet and contains no tracking.

**Setup**
This extension needs the free companion bridge server (Python, open source):
https://github.com/edwardidk02/claude-or-other-ai-control-over-firefox
Run `python install.py`, then click the toolbar icon and paste the token it shows.

**Limitations**
Clicks and typing are simulated page events; a few sites that only accept real keyboard and mouse
input will ignore them. Extensions cannot work on about: pages or addons.mozilla.org.

Not affiliated with, endorsed by or sponsored by Anthropic or Mozilla. "Claude" is a trademark of
Anthropic.

## Other listing fields

- Categories: Other / Developer Tools
- Tags: ai, automation, mcp, developer tools
- Homepage: https://github.com/edwardidk02/claude-or-other-ai-control-over-firefox
- Support site: https://github.com/edwardidk02/claude-or-other-ai-control-over-firefox/issues
- License: MIT
- Privacy policy: paste the text of PRIVACY.md

## Notes for Reviewers

This extension is the browser half of a local automation bridge. It does nothing on its own: it
long-polls a companion program on 127.0.0.1:18765 (source:
https://github.com/edwardidk02/claude-or-other-ai-control-over-firefox, `server/firefox_mcp.py`,
Python standard library only) and executes the browser actions that program sends, such as opening
a tab, reading the page or clicking an element. Requests need a token that the user pastes on the
options page; the token header forces a CORS preflight, so web pages cannot use the bridge.

- No remote code: it never evaluates code it receives. All page interaction is implemented in
  content.js (DOM events, form values). tabs.executeScript is only used with file: "content.js".
- It only acts on tabs inside its own tab group ("Claude"); other tabs are refused. A user tab only
  joins the group through the explicit tabs_adopt command.
- webRequest is used read-only to show the agent the requests of its own tabs (with sensitive query
  parameters redacted). captureTab is used for screenshots of its own tabs.
- No minified or generated code; the submitted files are the source.

How to test:
1. `git clone` the repository above and run `python install.py --no-register` (prints a token).
2. Install the extension, click its toolbar icon, paste the token, Save. The badge stays OFF until
   a client connects.
3. Without any AI client, from the repository folder:
   - `python try_bridge.py browser_status` → "Firefox: connected", badge turns ON
   - `python try_bridge.py tabs_create "{\"url\": \"https://example.com\"}"` → a tab opens in an
     orange "⏳ Claude" group with an orange glow
   - `python try_bridge.py get_page_text` → the page text
   - `python try_bridge.py set_task "{\"task\": \"Review\", \"status\": \"done\"}"` → group shows ✅,
     glow disappears
   (Or connect any MCP client, e.g. Claude Code, to `python server/firefox_mcp.py`.)
