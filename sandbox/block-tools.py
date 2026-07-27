#!/usr/bin/env python3
import json
import os
import sys

# Denies the tools Codex actually routes through PreToolUse: shell, unified_exec, apply_patch, and
# MCP. It does NOT see web search, filesystem reads, or several other tools, which have no hook
# handler, and Codex honors only a "deny" decision -- an "allow" is parsed and discarded. So this
# is a narrow first line, not the control that makes a review hermetic. That control is the worker,
# which watches the whole event stream and terminates the run on any activity it did not expect.
#
# The allow branch is kept because it costs nothing and would grant search if a future version does
# route it here. It is not what permits research today; the search tool is enabled per run by the
# worker passing features.web_search_request, and the marker records which mode this sandbox is in.
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
        else ("Only web search is available in this review." if os.path.exists(RESEARCH_MARKER)
              else "No tools are available in this review process."),
    }
}, sys.stdout)
