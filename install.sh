#!/usr/bin/env sh
set -eu

url="${SOL_GATE_URL:-https://sol-review-gate.vercel.app}"
repository_root="${SOL_REPOSITORY_ROOT:-https://raw.githubusercontent.com/cabibbz/SolReviewGate/main}"
install_root="${SOL_INSTALL_ROOT:-$HOME/.sol-review}"
skills_root="${SOL_CLAUDE_SKILLS_ROOT:-$HOME/.claude/skills}"

if [ -z "${SOL_GATE_CLIENT_TOKEN:-}" ]; then
  printf "Client token from the phone PWA: "
  stty -echo
  IFS= read -r token
  stty echo
  printf "\n"
else
  token="$SOL_GATE_CLIENT_TOKEN"
fi

case "$url" in
  https://*|http://localhost:*|http://127.0.0.1:*) ;;
  *) printf "The PWA address must use HTTPS.\n" >&2; exit 1 ;;
esac

case "$token" in
  *[!A-Za-z0-9_-]*) printf "The client token is invalid.\n" >&2; exit 1 ;;
esac
if [ "${#token}" -lt 20 ]; then
  printf "The client token is invalid.\n" >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  printf "Node.js 18 or newer is required.\n" >&2
  exit 1
fi
node_major="$(node --version | sed 's/^v//' | cut -d. -f1)"
if [ "$node_major" -lt 18 ]; then
  printf "Node.js 18 or newer is required.\n" >&2
  exit 1
fi
if ! command -v curl >/dev/null 2>&1; then
  printf "curl is required.\n" >&2
  exit 1
fi

verify="$(curl --fail --silent --show-error "$url/api/client/verify" -H "Authorization: Bearer $token")"
case "$verify" in
  *'"ok":true'*) ;;
  *) printf "The PWA could not verify this client token.\n" >&2; exit 1 ;;
esac

client_root="$install_root/client"
bin_root="$install_root/bin"
skill_root="$skills_root/sol"
mkdir -p "$client_root" "$bin_root" "$skill_root"

curl --fail --silent --show-error "$repository_root/plugins/solreview/bin/solreview.js" -o "$client_root/solreview.js"
curl --fail --silent --show-error "$repository_root/plugins/solreview/skills/sol/SKILL.md" -o "$skill_root/SKILL.md"
node --check "$client_root/solreview.js"

cat > "$install_root/remote.json" <<EOF
{"url":"$url","token":"$token"}
EOF
chmod 600 "$install_root/remote.json"

cat > "$bin_root/solreview" <<EOF
#!/usr/bin/env sh
exec node "$client_root/solreview.js" "\$@"
EOF
chmod 700 "$bin_root/solreview"

case ":$PATH:" in
  *":$bin_root:"*) ;;
  *)
    printf "\nexport PATH=\"\$PATH:%s\"\n" "$bin_root" >> "$HOME/.profile"
    ;;
esac

printf "\nSol Review is installed.\n"
printf "Restart your shell and Claude Code, then run /sol in any session.\n"
