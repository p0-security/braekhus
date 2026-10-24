#!/usr/bin/env bash
# Start an image as the tunnel client and as the server, and fail if either
# exits or never logs its ready line. Catches an image that crashes on start
# before it is pushed. Usage: start-image.sh <image> [platform]
set -eu

image=$1
platform=${2:-}

check() {
  local name=$1 ready=$2
  shift 2
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker run -d --name "$name" ${platform:+--platform "$platform"} "$image" "$@" >/dev/null
  for _ in $(seq 1 60); do
    if docker logs "$name" 2>&1 | grep -q "$ready"; then
      sleep 5
      if [ "$(docker inspect -f '{{.State.Running}}' "$name")" = true ]; then
        echo "ok: $name logged \"$ready\" and is still running"
        docker rm -f "$name" >/dev/null
        return 0
      fi
      break
    fi
    if [ "$(docker inspect -f '{{.State.Running}}' "$name")" != true ]; then
      break
    fi
    sleep 2
  done
  echo "FAIL: $name exited or never logged \"$ready\""
  docker logs "$name" 2>&1 | tail -40
  docker rm -f "$name" >/dev/null
  return 1
}

check braekhus-start-check-client "Running JSON-RPC client" start:prod:client \
  --targetUrl https://127.0.0.1 --clientId start-check --jwkPath /tmp \
  --tunnelHost 127.0.0.1 --tunnelPort 1
check braekhus-start-check-server "HTTP Proxy app listening" start:prod:server \
  --rpcPort 8080 --proxyPort 8081
