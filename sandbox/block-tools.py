#!/usr/bin/env python3
import json
import sys

# Codex hook compatibility format. The worker also watches JSON events and
# terminates the run if a tool event appears, so this is defense in depth.
json.load(sys.stdin)
json.dump({
    "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": "No tools are available in this review process."
    }
}, sys.stdout)
