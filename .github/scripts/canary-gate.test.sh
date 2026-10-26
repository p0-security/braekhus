#!/usr/bin/env bash
# Runs canary-gate.sh against a fake kubectl. Usage: canary-gate.test.sh
set -euo pipefail

gate=$(cd "$(dirname "$0")" && pwd)/canary-gate.sh
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

mkdir -p "$work/bin"
cat >"$work/bin/kubectl" <<'EOF'
#!/usr/bin/env bash
set -eu
echo "$*" >>"$STUB/calls"
args=()
while [ $# -gt 0 ]; do
  case $1 in
    --context | -n) shift 2 ;;
    --request-timeout=* | --timeout=*) shift ;;
    *) args+=("$1"); shift ;;
  esac
done
image=$(cat "$STUB/image")
pod() {
  jq -n --arg image "$image" --argjson restarts "$(cat "$STUB/restarts")" '{
    metadata: {name: "canary-1", uid: "u1"},
    spec: {containers: [{name: "braekhus", image: $image}]},
    status: {containerStatuses: [{name: "braekhus", ready: true, restartCount: $restarts,
      state: {running: {}}, imageID: "docker.io/p0security/braekhus@sha256:\("a" * 64)"}]}}'
}
case "${args[*]}" in
  "get deployment p0-braekhus-proxy -o json")
    jq -n --arg image "$image" '{spec: {selector: {matchLabels: {"app.kubernetes.io/name": "p0-braekhus-proxy"}},
      template: {spec: {containers: [{name: "braekhus", image: $image}]}}}}' ;;
  "set image deployment/p0-braekhus-proxy braekhus=p0security/braekhus:sha-old")
    if [ "$(cat "$STUB/restore_errors")" -gt 0 ]; then
      echo $(($(cat "$STUB/restore_errors") - 1)) >"$STUB/restore_errors"
      echo "Unable to connect to the server: i/o timeout" >&2
      exit 1
    fi
    echo "${args[3]#braekhus=}" >"$STUB/image" ;;
  "set image deployment/p0-braekhus-proxy braekhus="*) echo "${args[3]#braekhus=}" >"$STUB/image" ;;
  "rollout restart deployment/p0-braekhus-proxy") ;;
  "rollout status deployment/p0-braekhus-proxy") exit "$(cat "$STUB/rollout_exit")" ;;
  "get pods -l app.kubernetes.io/name=p0-braekhus-proxy -o json") pod | jq '{items: [.]}' ;;
  "get pod canary-1 -o json")
    if [ -f "$STUB/pod_gone" ]; then
      echo 'Error from server (NotFound): pods "canary-1" not found' >&2
      exit 1
    fi
    if [ "$(cat "$STUB/api_errors")" -gt 0 ]; then
      echo $(($(cat "$STUB/api_errors") - 1)) >"$STUB/api_errors"
      echo "Unable to connect to the server: i/o timeout" >&2
      exit 1
    fi
    pod ;;
  "logs canary-1 -c braekhus") cat "$STUB/log" ;;
  *) echo "fake kubectl: unexpected: ${args[*]}" >&2; exit 2 ;;
esac
EOF
chmod +x "$work/bin/kubectl"

ack='{"level":30,"time":1,"msg":"setClientId response","response":{"ok":true}}'
closed_now() { echo "{\"level\":30,\"time\":$(($(date +%s) * 1000 + 1000)),\"msg\":\"connection closed\"}"; }
# called_now [status]
called_now() {
  echo "{\"level\":30,\"time\":$(($(date +%s) * 1000 + 1000)),\"msg\":\"first forwarded response\",\"status\":${1:-200},\"elapsedMs\":12}"
}

failures=0
# run <name> <want exit> <want output regex> <image arg> [VAR=value ...]
run() {
  local name=$1 want=$2 pattern=$3 arg=$4
  shift 4
  export STUB=$work/$name
  mkdir -p "$STUB"
  [ -f "$STUB/image" ] || echo "p0security/braekhus:sha-old" >"$STUB/image"
  [ -f "$STUB/restarts" ] || echo 0 >"$STUB/restarts"
  [ -f "$STUB/rollout_exit" ] || echo 0 >"$STUB/rollout_exit"
  [ -f "$STUB/api_errors" ] || echo 0 >"$STUB/api_errors"
  [ -f "$STUB/restore_errors" ] || echo 0 >"$STUB/restore_errors"
  [ -f "$STUB/log" ] || printf '%s\n' "not json" "$ack" "$(called_now)" >"$STUB/log"
  local out code=0
  out=$(env PATH="$work/bin:$PATH" CANARY_KUBE_CONTEXT=fake CANARY_SOAK_SECONDS=0 \
    CANARY_POLL_SECONDS=1 "$@" "$gate" "$arg" 2>&1) || code=$?
  if [ "$code" != "$want" ] || ! grep -Eq "$pattern" <<<"$out"; then
    echo "not ok: $name (exit $code, want $want, want output /$pattern/)"
    printf '%s\n' "$out"
    failures=$((failures + 1))
  else
    echo "ok: $name"
  fi
}

run pass 0 "PASS: p0security/braekhus:sha-new" p0security/braekhus:sha-new
grep -q "set image deployment/p0-braekhus-proxy braekhus=p0security/braekhus:sha-new" "$work/pass/calls" ||
  { echo "not ok: pass did not set the image"; failures=$((failures + 1)); }

digest_ref=p0security/braekhus@sha256:$(printf 'b%.0s' {1..64})
run digest 0 "PASS: $digest_ref" "$digest_ref"
grep -q "set image deployment/p0-braekhus-proxy braekhus=$digest_ref" "$work/digest/calls" ||
  { echo "not ok: digest did not set the digest ref"; failures=$((failures + 1)); }

mkdir -p "$work/same" && echo "p0security/braekhus:sha-new" >"$work/same/image"
run same 0 "PASS" p0security/braekhus:sha-new
grep -q "rollout restart" "$work/same/calls" ||
  { echo "not ok: same image did not restart"; failures=$((failures + 1)); }

mkdir -p "$work/restarted" && echo 1 >"$work/restarted/restarts"
run restarted 1 "restarted 1 times" p0security/braekhus:sha-new
[ "$(cat "$work/restarted/image")" = "p0security/braekhus:sha-old" ] ||
  { echo "not ok: restarted did not restore the old image"; failures=$((failures + 1)); }

mkdir -p "$work/flaky" && echo 2 >"$work/flaky/api_errors"
run flaky 0 "Could not read pod canary-1 \(2 of 4\)" p0security/braekhus:sha-new
[ "$(cat "$work/flaky/image")" = "p0security/braekhus:sha-new" ] ||
  { echo "not ok: flaky did not keep the new image"; failures=$((failures + 1)); }

mkdir -p "$work/apidown" && echo 99 >"$work/apidown/api_errors"
run apidown 1 "could not read pod canary-1 4 times in a row" p0security/braekhus:sha-new
[ "$(cat "$work/apidown/image")" = "p0security/braekhus:sha-old" ] ||
  { echo "not ok: apidown did not restore the old image"; failures=$((failures + 1)); }

mkdir -p "$work/gone" && touch "$work/gone/pod_gone"
run gone 1 "pod canary-1 is gone" p0security/braekhus:sha-new
[ "$(grep -c "get pod canary-1" "$work/gone/calls")" = 1 ] ||
  { echo "not ok: gone retried a NotFound"; failures=$((failures + 1)); }

mkdir -p "$work/restoreretry" && echo 1 >"$work/restoreretry/restarts" && echo 2 >"$work/restoreretry/restore_errors"
run restoreretry 1 "Restored the canary to p0security/braekhus:sha-old" p0security/braekhus:sha-new
[ "$(cat "$work/restoreretry/image")" = "p0security/braekhus:sha-old" ] ||
  { echo "not ok: restoreretry did not restore the old image"; failures=$((failures + 1)); }

mkdir -p "$work/rollout" && echo 1 >"$work/rollout/rollout_exit"
run rollout 1 "did not finish" p0security/braekhus:sha-new

mkdir -p "$work/noack" && echo '{"msg":"connection opened"}' >"$work/noack/log"
run noack 1 "never acknowledged" p0security/braekhus:sha-new

mkdir -p "$work/down" && { echo "$ack"; closed_now; } >"$work/down/log"
run down 1 "closed at the end" p0security/braekhus:sha-new

mkdir -p "$work/flap" && { echo "$ack"; for _ in 1 2 3; do closed_now; echo "$ack"; done; } >"$work/flap/log"
run flap 1 "closed 3 times" p0security/braekhus:sha-new

mkdir -p "$work/nocall" && echo "$ack" >"$work/nocall/log"
run nocall 1 "P0 made no successful call through the tunnel" p0security/braekhus:sha-new

mkdir -p "$work/call5xx" && { echo "$ack"; called_now 503; called_now 404; } >"$work/call5xx/log"
run call5xx 1 "P0 made no successful call" p0security/braekhus:sha-new

mkdir -p "$work/callbefore" && { echo "$ack"; echo '{"time":1,"msg":"first forwarded response","status":200}'; } >"$work/callbefore/log"
run callbefore 0 "1 connections with a successful call" p0security/braekhus:sha-new

mkdir -p "$work/callreconnect" && { echo "$ack"; called_now 500; closed_now; echo "$ack"; called_now 204; } >"$work/callreconnect/log"
run callreconnect 0 "1 closes and 1 connections with a successful call" p0security/braekhus:sha-new

mkdir -p "$work/checkonly"
run checkonly 1 "runs p0security/braekhus:sha-old, not" p0security/braekhus:sha-new CANARY_CHECK_ONLY=1
! grep -q "set image" "$work/checkonly/calls" ||
  { echo "not ok: check-only changed the image"; failures=$((failures + 1)); }

# Cancelling the job sends the gate a signal mid-soak.
export STUB=$work/cancel
mkdir -p "$STUB"
echo "p0security/braekhus:sha-old" >"$STUB/image"
printf '%s\n' 0 >"$STUB/restarts"
for f in rollout_exit api_errors restore_errors; do echo 0 >"$STUB/$f"; done
printf '%s\n' "$ack" "$(called_now)" >"$STUB/log"
env PATH="$work/bin:$PATH" CANARY_KUBE_CONTEXT=fake CANARY_SOAK_SECONDS=60 CANARY_POLL_SECONDS=1 \
  "$gate" p0security/braekhus:sha-new >"$STUB/out" 2>&1 &
gate_pid=$!
for _ in $(seq 1 50); do grep -q "Soaking" "$STUB/out" && break; sleep 0.1; done
kill -TERM "$gate_pid"
code=0
wait "$gate_pid" || code=$?
if [ "$code" = 143 ] && grep -q "Cancelled, so the rollout was not watched" "$STUB/out" &&
  [ "$(cat "$STUB/image")" = "p0security/braekhus:sha-old" ] && ! grep -q "rollout status" <(tail -n 1 "$STUB/calls"); then
  echo "ok: cancel"
else
  echo "not ok: cancel (exit $code, want 143)"
  cat "$STUB/out"
  failures=$((failures + 1))
fi

run noargs 1 "empty or has whitespace" ""
run nocontext 0 "PASS" p0security/braekhus:sha-new CANARY_KUBE_CONTEXT=
! grep -q -- "--context" "$work/nocontext/calls" ||
  { echo "not ok: nocontext passed --context"; failures=$((failures + 1)); }
grep -q -- "--context fake" "$work/pass/calls" ||
  { echo "not ok: pass did not pass --context"; failures=$((failures + 1)); }

[ "$failures" = 0 ] || { echo "$failures failed"; exit 1; }
echo "all passed"
