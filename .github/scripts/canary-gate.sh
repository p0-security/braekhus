#!/usr/bin/env bash
# Roll the P0-owned canary tunnel client onto an image, soak it, and exit 0
# only if the pod stayed up, its tunnel to the server stayed registered, and P0
# made a successful call through the tunnel.
# On failure it puts the canary back on the image it ran before.
#
# Usage: canary-gate.sh <image-ref>
#
# Optional:
#   CANARY_KUBE_CONTEXT          default the current kubeconfig context
#   CANARY_NAMESPACE             default p0-security
#   CANARY_DEPLOYMENT            default p0-braekhus-proxy
#   CANARY_CONTAINER             default braekhus
#   CANARY_ROLLOUT_TIMEOUT       seconds, default 300
#   CANARY_SOAK_SECONDS          default 600
#   CANARY_POLL_SECONDS          default 15
#   CANARY_MAX_RECONNECTS        tunnel closes allowed during the soak, default 2
#   CANARY_CHECK_ONLY=1          change nothing: soak and check the running pod
set -euo pipefail

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

[ $# -eq 1 ] || fail "usage: canary-gate.sh <image-ref>"
image=$1
[[ $image =~ ^[^[:space:]]+$ ]] || fail "image ref is empty or has whitespace"

ns=${CANARY_NAMESPACE:-p0-security}
deploy=${CANARY_DEPLOYMENT:-p0-braekhus-proxy}
container=${CANARY_CONTAINER:-braekhus}
rollout_timeout=${CANARY_ROLLOUT_TIMEOUT:-300}
soak=${CANARY_SOAK_SECONDS:-600}
poll=${CANARY_POLL_SECONDS:-15}
max_reconnects=${CANARY_MAX_RECONNECTS:-2}
check_only=${CANARY_CHECK_ONLY:-0}

for n in "$rollout_timeout" "$soak" "$poll" "$max_reconnects"; do
  [[ $n =~ ^[0-9]+$ ]] || fail "timing and count settings must be whole numbers, got '$n'"
done
[ "$poll" -gt 0 ] || fail "CANARY_POLL_SECONDS must be at least 1"

for tool in kubectl jq; do
  command -v "$tool" >/dev/null || fail "$tool is not installed"
done

kube_args=()
tmpdir=$(mktemp -d)
mutated=0
passed=0
interrupted=0
previous_image=

restore() {
  # A second signal during the restore would cut it short.
  trap '' INT TERM
  if [ "$mutated" = 1 ] && [ "$passed" = 0 ] && [ -n "$previous_image" ] && [ "$previous_image" != "$image" ]; then
    echo "Restoring the canary to $previous_image" >&2
    local attempt reverted=0
    for attempt in 1 2 3; do
      if kube set image "deployment/$deploy" "$container=$previous_image" >/dev/null; then
        reverted=1
        break
      fi
      [ "$attempt" = 3 ] || sleep 5
    done
    if [ "$reverted" = 0 ]; then
      echo "Could not restore the canary to $previous_image. It needs a person." >&2
    elif [ "$interrupted" = 1 ]; then
      # The runner kills the job a few seconds after it cancels it.
      echo "Set the canary back to $previous_image. Cancelled, so the rollout was not watched." >&2
    elif kube_wait >/dev/null; then
      echo "Restored the canary to $previous_image" >&2
    else
      echo "Set the canary back to $previous_image, but its rollout did not finish. It needs a person." >&2
    fi
  fi
  rm -rf "$tmpdir"
}
trap restore EXIT
trap 'interrupted=1; exit 130' INT
trap 'interrupted=1; exit 143' TERM

kube() {
  kubectl ${kube_args[@]+"${kube_args[@]}"} --request-timeout=30s -n "$ns" "$@"
}

# No --request-timeout here: it would cut off the watch that rollout status
# holds open. --timeout bounds the wait instead.
kube_wait() {
  kubectl ${kube_args[@]+"${kube_args[@]}"} -n "$ns" rollout status "deployment/$deploy" --timeout="${rollout_timeout}s"
}

if [ -n "${CANARY_KUBE_CONTEXT:-}" ]; then
  kube_args+=(--context "$CANARY_KUBE_CONTEXT")
fi

deploy_json=$(kube get deployment "$deploy" -o json) || fail "could not read deployment $ns/$deploy"
previous_image=$(jq -er --arg c "$container" \
  '.spec.template.spec.containers[] | select(.name == $c) | .image' <<<"$deploy_json") ||
  fail "deployment $ns/$deploy has no container named $container"
selector=$(jq -er '.spec.selector.matchLabels | to_entries | map("\(.key)=\(.value)") | join(",")' <<<"$deploy_json") ||
  fail "deployment $ns/$deploy has no matchLabels selector"
echo "Canary $ns/$deploy runs $previous_image"

if [ "$check_only" = 1 ]; then
  echo "CANARY_CHECK_ONLY=1: checking the running pod without changing it"
else
  mutated=1
  if [ "$previous_image" = "$image" ]; then
    # set image is a no-op when the ref is unchanged, and the point is to see
    # this image start, so restart to force a fresh pull and start.
    kube rollout restart "deployment/$deploy" >/dev/null || fail "could not restart $ns/$deploy"
  else
    kube set image "deployment/$deploy" "$container=$image" >/dev/null || fail "could not set the image on $ns/$deploy"
  fi
  echo "Waiting up to ${rollout_timeout}s for the rollout of $image"
  kube_wait || fail "rollout of $image did not finish in ${rollout_timeout}s"
fi

pods_json=$(kube get pods -l "$selector" -o json) || fail "could not list pods for $selector"
pod=$(jq -r '[.items[] | select(.metadata.deletionTimestamp == null)] | if length == 1 then .[0].metadata.name else empty end' <<<"$pods_json")
[ -n "$pod" ] || fail "expected exactly one live pod for $selector, found $(jq '[.items[] | select(.metadata.deletionTimestamp == null)] | length' <<<"$pods_json")"
pod_json=$(jq --arg p "$pod" '.items[] | select(.metadata.name == $p)' <<<"$pods_json")
pod_uid=$(jq -r '.metadata.uid' <<<"$pod_json")
pod_image=$(jq -r --arg c "$container" '.spec.containers[] | select(.name == $c) | .image' <<<"$pod_json")
[ "$pod_image" = "$image" ] || fail "pod $pod runs $pod_image, not $image"

# Prints the problem with the pod, or nothing if it is healthy. Returns 75 when
# the API call failed for a reason other than NotFound, so the soak can retry.
check_pod() {
  local json
  if ! json=$(kube get pod "$pod" -o json 2>"$tmpdir/get-pod.err"); then
    if grep -q '(NotFound)' "$tmpdir/get-pod.err"; then
      echo "pod $pod is gone"
      return 0
    fi
    return 75
  fi
  jq -r --arg uid "$pod_uid" --arg c "$container" '
    (.status.containerStatuses // [] | map(select(.name == $c)) | .[0]) as $s
    | if .metadata.uid != $uid then "pod \(.metadata.name) was replaced"
      elif $s == null then "container \($c) has no status"
      elif $s.restartCount != 0 then "container \($c) restarted \($s.restartCount) times, last state \($s.lastState | tostring)"
      elif $s.state.running == null then "container \($c) is not running: \($s.state | tostring)"
      elif $s.ready != true then "container \($c) is not Ready"
      else empty end' <<<"$json"
}

max_api_errors=4
api_errors=0
soak_start_ms=$(($(date +%s) * 1000))
deadline=$(($(date +%s) + soak))
echo "Soaking pod $pod for ${soak}s"
while :; do
  code=0
  problem=$(check_pod) || code=$?
  if [ "$code" = 75 ]; then
    api_errors=$((api_errors + 1))
    echo "Could not read pod $pod ($api_errors of $max_api_errors): $(head -c 300 "$tmpdir/get-pod.err")" >&2
    [ "$api_errors" -lt "$max_api_errors" ] || fail "could not read pod $pod $api_errors times in a row"
  else
    [ "$code" = 0 ] || fail "could not parse the status of pod $pod"
    api_errors=0
    [ -z "$problem" ] || fail "$problem"
    [ "$(date +%s)" -lt "$deadline" ] || break
  fi
  sleep "$poll"
done
echo "ok: pod $pod stayed Ready with no restarts for ${soak}s"

# The client logs "setClientId response" with {"ok":true} only after the
# server has verified the client's JWT against the key registered in P0 and
# registered the tunnel under the client ID. The client logs "first forwarded
# response" once per connection, so the call check counts the whole log of
# this container, not only the soak: a call just before the soak started would
# hide later calls on the same connection. P0 refresh-cache calls through the
# tunnel every 5 minutes. Pino writes one JSON object per line. fromjson?
# skips any line that is not JSON.
kube logs "$pod" -c "$container" >"$tmpdir/pod.log" || fail "could not read logs of $pod"
verdict=$(jq -R -s -r --argjson since "$soak_start_ms" --argjson max "$max_reconnects" '
  [split("\n")[] | fromjson? | select(type == "object")] as $lines
  | [$lines[] | select(.msg == "connection closed" or (.msg == "setClientId response" and .response.ok == true))] as $ev
  | ([$ev[] | select(.msg == "setClientId response")] | length) as $acks
  | ([$ev[] | select(.msg == "connection closed" and (.time // 0) >= $since)] | length) as $closes
  | ([$lines[] | select(.msg == "first forwarded response"
      and (.status | type) == "number" and .status >= 200 and .status <= 299)] | length) as $calls
  | if $acks == 0 then "FAIL the server never acknowledged the tunnel (no setClientId response)"
    elif ($ev | last | .msg) != "setClientId response" then "FAIL the tunnel was closed at the end of the soak and not re-registered"
    elif $closes > $max then "FAIL the tunnel closed \($closes) times during the soak, more than \($max)"
    elif $calls == 0 then "FAIL P0 made no successful call through the tunnel"
    else "ok the server acknowledged the tunnel \($acks) times, \($closes) closes and \($calls) connections with a successful call from P0" end' \
  "$tmpdir/pod.log") || fail "could not parse the logs of $pod"
case $verdict in
  ok\ *) echo "ok: ${verdict#ok }" ;;
  *)
    tail -n 40 "$tmpdir/pod.log" >&2
    fail "${verdict#FAIL }"
    ;;
esac

passed=1
echo "PASS: $image ran on the canary for ${soak}s with its tunnel up and serving P0"
