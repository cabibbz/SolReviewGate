#!/usr/bin/env python3
import json
import os
import sys

# Every tool is denied. A run started with research enabled writes /opt/solgate/research-enabled,
# and only then is a web search permitted. Shell, file, and MCP tools are denied either way.
# The worker also watches the JSON event stream and terminates the run on any tool event it did
# not expect, so this is defense in depth rather than the only control.
RESEARCH_MARKER = "/opt/solgate/research-enabled"
SEARCH_TOOLS = {"web_search", "web_search_preview", "browser_search", "search"}

payload = json.load(sys.stdin)
name = ""
for key in ("tool_name", "toolName", "name"):
    value = payload.get(key)
    if isinstance(value, str) and value:
        name = value.lower()
        break

allowed = os.path.exists(RESEARCH_MARKER) and any(tool in name for tool in SEARCH_TOOLS)
json.dump({
    "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "allow" if allowed else "deny",
        "permissionDecisionReason": "Web search is available for this review." if allowed
        else "No tools are available in this review process.",
    }
}, sys.stdout)
