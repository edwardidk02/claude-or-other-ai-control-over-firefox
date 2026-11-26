# Privacy policy — Local Browser Bridge

_Last updated: 26 November 2026_

Local Browser Bridge is a Firefox extension that lets an AI agent running **on your own computer**
(for example Claude Code) control browser tabs.

## What the extension handles

To do what the agent asks, the extension reads and sends the following **only to a program on your
own computer** (the bridge server at `127.0.0.1`, which you install and start yourself):

- **Website content** of the tabs the agent works in: page text, the page structure, screenshots,
  console messages and network request URLs (with sensitive query parameters such as `token` or
  `password` replaced by `REDACTED`).
- **Browsing activity** needed for the task: titles and addresses of the agent's own tabs. Only when
  the agent explicitly asks to list all tabs (`tabs_context` with `all`) does it receive the titles
  of your other tabs; it never reads their content.

## What the extension does not do

- It does **not** send any data to the developer or to any server on the internet. Its only network
  connection is to `127.0.0.1` (your own computer).
- It contains no analytics, tracking, advertising or telemetry.
- It does not read or act on tabs outside its own "Claude" tab group, unless you ask the agent to
  take over a specific tab.
- It stores only one setting in Firefox: the token and port you enter on its settings page.

## The AI agent you connect

What happens with data **after** it reaches the bridge on your computer is decided by the AI agent
you connect to it. For example, Claude Code sends the conversation, including page content it read,
to Anthropic to generate responses, under Anthropic's own privacy policy. Only connect agents you
trust, and do not let the agent work on pages whose content you do not want to share with it.

## Contact

Questions or issues: <https://github.com/edwardidk02/claude-or-other-ai-control-over-firefox/issues>
