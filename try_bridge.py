"""Try the bridge by hand, without an AI client.

    python try_bridge.py browser_status
    python try_bridge.py tabs_create "{\"url\": \"https://example.com\"}"
    python try_bridge.py get_page_text
    python try_bridge.py set_task "{\"task\": \"Manual test\", \"status\": \"done\"}"

Runs one tool of server/firefox_mcp.py and prints the result (screenshots are saved as .jpg in the
current folder). Needs `python install.py` first and the extension installed with the token saved.
"""
import base64
import importlib.util
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    name = sys.argv[1]
    args = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
    spec = importlib.util.spec_from_file_location("bridge", os.path.join(HERE, "server", "firefox_mcp.py"))
    bridge = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bridge)
    if bridge.try_become_hub():
        # we host the bridge: give the extension a moment to find it (it retries every few seconds)
        start = time.time()
        while not bridge.HUB.extension_connected() and time.time() - start < 30:
            time.sleep(0.3)
    content, is_error = bridge.run_tool(name, args)
    for item in content:
        if item["type"] == "image":
            path = os.path.abspath(f"screenshot-{int(time.time())}.jpg")
            with open(path, "wb") as f:
                f.write(base64.b64decode(item["data"]))
            print(f"[screenshot saved: {path}]")
        else:
            print(item["text"])
    return 1 if is_error else 0


if __name__ == "__main__":
    sys.exit(main())
