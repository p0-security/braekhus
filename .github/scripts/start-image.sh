#!/usr/bin/env bash
# Start an image as the tunnel server and client, send a request through them
# to a listener, and fail unless the listener's reply comes back. Catches an
# image that cannot carry traffic before it is pushed.
# Usage: start-image.sh <image> [platform]
set -eu

image=$1
platform=${2:-}
listener_image=hashicorp/http-echo:1.0.0@sha256:fcb75f691c8b0414d670ae570240cbf95502cc18a9ba57e982ecac589760a186
body=braekhus-e2e
net=braekhus-e2e
volume=braekhus-e2e-keys
url=http://127.0.0.1:8081/client

cleanup() {
  docker rm -f braekhus-e2e-listener braekhus-e2e-client braekhus-e2e-server >/dev/null 2>&1 || true
  docker network rm "$net" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
  rm -rf "${keys:-}"
}

# The install page has customers read the public key this same way.
client_public_key() {
  docker exec braekhus-e2e-client /bin/cat /p0-files/jwk.public.json 2>/dev/null
}

fail() {
  echo "FAIL: $1"
  for name in listener client server; do
    echo "--- braekhus-e2e-$name"
    docker logs "braekhus-e2e-$name" 2>&1 | tail -40
  done
  exit 1
}

start() {
  local name=$1
  shift
  docker run -d --name "braekhus-e2e-$name" --network "$net" --network-alias "$name" "$@" >/dev/null
}

cleanup
# Docker must be able to share TMPDIR. On colima, point it under $HOME.
keys=$(mktemp -d "${TMPDIR:-/tmp}/braekhus-e2e.XXXXXX")
trap cleanup EXIT
docker network create "$net" >/dev/null
# The client chowns its key directory to uid 65532 and leaves root, so the
# runner could not read a bind mount afterwards. A volume starts root-owned,
# as a customer's PersistentVolumeClaim does, and is read through the container.
docker volume create "$volume" >/dev/null

start listener "$listener_image" -text "$body"
start client -v "$volume:/p0-files" ${platform:+--platform "$platform"} "$image" start:prod:client \
  --targetUrl http://listener:5678 --clientId e2e --jwkPath /p0-files \
  --tunnelHost server --tunnelPort 8080 --insecure

# The client writes its keypair on first start, and the server reads the
# public half from its working directory.
for _ in $(seq 1 30); do
  client_public_key >"$keys/jwk.public.json" || true
  [ -s "$keys/jwk.public.json" ] && break
  sleep 2
done
[ -s "$keys/jwk.public.json" ] || fail "client never wrote jwk.public.json"

# The client logs its uid once it has left root.
docker logs braekhus-e2e-client 2>&1 | grep -q '"uid":65532' || fail "client did not drop root"
echo "ok: client dropped to uid 65532"

start server -p 127.0.0.1:8081:8081 \
  -v "$keys/jwk.public.json:/usr/src/app/packages/braekhus/jwk.public.json:ro" \
  ${platform:+--platform "$platform"} "$image" start:prod:server --rpcPort 8080 --proxyPort 8081

for _ in $(seq 1 30); do
  got=$(curl -s -m 5 -w ' %{http_code}' "$url/e2e/" | tr -d '\n' || true)
  [ "$got" = "$body 200" ] && break
  sleep 2
done
[ "$got" = "$body 200" ] || fail "expected \"$body 200\" from $url/e2e/, got \"$got\""
echo "ok: $url/e2e/ returned the listener's body"

got=$(curl -s -m 30 -o /dev/null -w '%{http_code}' "$url/nope/" || true)
[ "$got" = 502 ] || fail "expected 502 from $url/nope/, got $got"
echo "ok: $url/nope/ returned 502"
