#!/usr/bin/env python3
import json
import os
import re
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

# Codex names its web tool `webrun`, not `web_search`. An allowlist of guessed names denied every
# search this gate was built to permit, silently, for the entire life of the feature. So the rule is
# now shaped the other way round: in a researched run, permit a tool that reads the web and refuse
# anything that could act. A name nobody anticipated is refused unless it clearly belongs to the
# reading family, and the worker's event-stream guard still terminates the run on anything it did
# not expect, so this is a first line rather than the only one.
READS_THE_WEB = re.compile(r"web|search|browse|fetch|http|url", re.I)
CAN_ACT = re.compile(
    r"shell|exec|command|apply|patch|write|edit|create|delete|remove|move|copy|"
    r"mcp|bash|python|node|process|kill|spawn|file|dir|path",
    re.I,
)

payload = json.load(sys.stdin)
name = ""
for key in ("tool_name", "toolName", "name"):
    value = payload.get(key)
    if isinstance(value, str) and value:
        name = value.lower()
        break

# Every tool call passes through here, and this is the only place proven to see one. Two `webrun`
# calls in a production run produced no item at all in `codex exec --json`, so counting searches
# from the event stream reports zero on a run that searched perfectly. The record is written here
# instead. Observation must never be able to break the gate, so every failure is swallowed.
CALL_LOG = "/tmp/sol-tool-calls.ndjson"


def note_call(tool, decision, payload):
    try:
        supplied = payload.get("tool_input") or payload.get("toolInput") or {}
        query = ""
        if isinstance(supplied, dict):
            for key in ("query", "q", "search", "search_query", "input", "prompt", "url"):
                value = supplied.get(key)
                if isinstance(value, str) and value.strip():
                    query = value.strip()[:200]
                    break
        with open(CALL_LOG, "a", encoding="utf-8") as handle:
            handle.write(json.dumps({"tool": tool[:80], "decision": decision, "query": query}) + "\n")
    except Exception:
        pass


researching = os.path.exists(RESEARCH_MARKER)
allowed = researching and bool(READS_THE_WEB.search(name)) and not CAN_ACT.search(name)

if allowed:
    reason = "Web search is available for this review."
elif researching:
    # Name the tool. The block that finally explained this feature was readable only because Codex
    # logged the tool name itself; the gate should not depend on that.
    reason = f"This review permits web search only. Refused: {name or 'an unnamed tool'}."
else:
    reason = f"No tools are available in this review process. Refused: {name or 'an unnamed tool'}."

note_call(name, "allow" if allowed else "deny", payload)

json.dump({
    "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "allow" if allowed else "deny",
        "permissionDecisionReason": reason,
    }
}, sys.stdout)
