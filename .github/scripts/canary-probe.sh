#!/usr/bin/env bash
# Send requests from the stage braekhus server through the tunnel to the
# canary client, which forwards them to the EKS API. Fails when a request and
# its retry both fail.
# Usage: canary-probe.sh <minutes>
set -eu

minutes=${1:-}
[[ $minutes =~ ^[1-9][0-9]*$ ]] || { echo "Usage: canary-probe.sh <minutes>"; exit 1; }
interval=10
requests=$((minutes * 60 / interval))
# /readyz needs no token.
probe_path=/api/v1/namespaces/p0-namespace/services/p0app-stage-braekhus:proxy/proxy/client/p0-stage:EKS-stage-cluster-v2/readyz

# /readyz answers "ok" with no newline, which held back the whole log.
probe() { kubectl get --raw "$probe_path" --request-timeout=10s >/dev/null; }

# The new pod takes a few seconds to register its tunnel.
for i in $(seq 12); do
  probe && break
  echo "Tunnel not up yet ($i/12), waiting 5s..."
  sleep 5
done

echo "Sending $requests requests, one every ${interval}s, for $minutes minutes"
# One retry covers the tunnel's hourly reconnect.
for i in $(seq "$requests"); do
  probe || { echo "Request $i/$requests failed, retrying in 5s..."; sleep 5; probe; }
  echo "Request $i/$requests succeeded, waiting ${interval}s..."
  sleep "$interval"
done
