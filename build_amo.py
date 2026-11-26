"""Build the version for addons.mozilla.org (self-distributed / "On your own").

Differences from the local development build in extension/:
- neutral name and icon (no Anthropic/Claude branding as the product name)
- no token inside the package: config.js is left out; the token is set once on the
  extension's options page (click the toolbar button)
- the `javascript` tool is stripped (AMO policy: no executing code from outside the package)
- data_collection_permissions declared (required for new add-ons since Nov 2025)

Output: dist/local-browser-bridge-<version>.zip
"""
import json
import os
import re
import shutil
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "extension")
OUT = os.path.join(HERE, "build", "amo")
FILES = ["background.js", "content.js", "options.html", "options.js"]

NAME = "Local Browser Bridge"
ID = "local-browser-bridge@bridge.localhost"
DESCRIPTION = ("Lets a local AI coding agent (for example Claude Code) control browser tabs through a bridge "
               "on 127.0.0.1. Only acts on tabs in its own tab group. Not affiliated with Anthropic or Mozilla.")


def strip_dev_only(js):
    return re.sub(r"/\* @dev-only-start.*?/\* @dev-only-end \*/\n?", "", js, flags=re.S)


def main():
    shutil.rmtree(OUT, ignore_errors=True)
    os.makedirs(OUT)
    for f in FILES:
        text = open(os.path.join(SRC, f), encoding="utf-8").read()
        if f == "background.js":
            text = strip_dev_only(text)
            assert "executeScript(t.id, { code" not in text, "javascript tool not stripped"
        open(os.path.join(OUT, f), "w", encoding="utf-8", newline="\n").write(text)
    shutil.copy2(os.path.join(HERE, "amo", "icon.svg"), os.path.join(OUT, "icon.svg"))

    m = json.load(open(os.path.join(SRC, "manifest.json"), encoding="utf-8"))
    m["name"] = NAME
    m["description"] = DESCRIPTION
    m["browser_specific_settings"] = {"gecko": {
        "id": ID,
        "strict_min_version": "142.0",
        "data_collection_permissions": {"required": ["websiteContent", "browsingActivity"]},
    }}
    m["background"]["scripts"] = ["background.js"]          # no config.js / token
    m["browser_action"]["default_title"] = NAME
    json.dump(m, open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8", newline="\n"), indent=2, ensure_ascii=False)

    os.makedirs(os.path.join(HERE, "dist"), exist_ok=True)
    zpath = os.path.join(HERE, "dist", f"local-browser-bridge-{m['version']}.zip")
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for name in sorted(os.listdir(OUT)):
            z.write(os.path.join(OUT, name), name)
    print("built", zpath)
    print("files:", sorted(os.listdir(OUT)))


if __name__ == "__main__":
    main()
