# Braekhus

Braekhus is a NAT hole-punching HTTP reverse proxy. It allows you to send encrypted web traffic to a server on a private network, from the Internet, without altering firewall settings.

The target server must be able to send requests out from the private network, e.g. via a NAT Gateway.

## Development

### Lockfile Management
To enable git submoduling, the lockfile for this repo is committed as `.yarn.lock`. If you're working on this repo in isolation, run `yarn :show-lockfile`. To revert this change, `yarn :hide-lockfile`.

If you experience problems with your `node_modules` after changing the lockfile mode, run `yarn :clean-node-modules`.

### Running locally

1. Run a target service that HTTP requests will be forwarded to. An easy way is with python: `python3 -m http.server 8000` - this will serve the contents of the folder where the command runs.
2. Run the server: `yarn start:dev:server --rpcPort 8080 --proxyPort 8081`
3. Run the client: `yarn start:dev:client --targetUrl http://localhost:8000 --clientId myClientId --tunnelHost localhost --tunnelPort 8080 --insecure true --jwkPath .`

Then send an HTTP request to the server's proxy port:

```
curl -i -X GET "http://localhost:8081/client/myClientId"
```

Note, the `--clientId` argument must match the client ID path component that is used in the HTTP call the proxy server.
Response (if the python server runs at the repo root):

```
HTTP/1.1 200 OK
X-Powered-By: Express
server: SimpleHTTP/0.6 Python/3.9.6
date: Tue, 27 Jun 2023 17:27:05 GMT
Content-Type: text/html; charset=utf-8
Content-Length: 676
ETag: W/"2a4-WaKIE7XO7Rg8z7h6eIR+ypYeV88"
Connection: keep-alive
Keep-Alive: timeout=5

<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01//EN" "http://www.w3.org/TR/html4/strict.dtd">
<html>
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<title>Directory listing for /</title>
</head>
<body>
<h1>Directory listing for /</h1>
<hr>
<ul>
<li><a href=".dockerignore">.dockerignore</a></li>
<li><a href=".git/">.git/</a></li>
<li><a href=".gitignore">.gitignore</a></li>
<li><a href=".hadolint.yaml">.hadolint.yaml</a></li>
<li><a href="Dockerfile">Dockerfile</a></li>
<li><a href="k8s/">k8s/</a></li>
<li><a href="README.md">README.md</a></li>
<li><a href="ts/">ts/</a></li>
</ul>
<hr>
</body>
</html>
```

### Connect client to Kubernetes

The client needs the additional root certificate of the Kubernetes cluster. Specify the path to that certificate in the `NODE_EXTRA_CA_CERTS` environment variable:

```
NODE_EXTRA_CA_CERTS=./ca.pem yarn start:dev:client ...
```

Use the public (or private IP if behind firewall) of the Kubernetes cluster as the `--targetUrl` argument.
Example command:

```
NODE_EXTRA_CA_CERTS=./client/ca.pem yarn start:dev:client --targetUrl https://{{ip-or-host}} --clientId myClientId --tunnelHost localhost --tunnelPort 8080
```

### Response filter

A request can carry a `braekhus-response-jq-transform` header with a jq program. The client runs it on the target's successful (2xx) response and returns the result. The client needs `jq` on its `PATH`, or at `JQ_PATH`; the published image provides it.

- Responses that are not 2xx are returned unchanged, so a caller still sees the target's own error body.
- If jq cannot be applied to a 2xx response, because the program is invalid, fails at runtime, or the input is over the limit, the call fails and the proxy answers 502. The unfiltered body is never returned in its place.
- By default there is no limit on the size of the response handed to jq. `BRAEKHUS_JQ_MAX_INPUT_BYTES` sets one, measured on the bytes the target sent after decompression. The client aborts the download once the body passes it and the call fails with a 502. A value that is not a positive integer is ignored with a warning. The output is not limited.
- `BRAEKHUS_JQ_INPUT_LIMIT_MODE=warn` logs a warning for every response over the limit and runs jq on it anyway, to see which responses a limit would reject before enforcing it. Without `BRAEKHUS_JQ_MAX_INPUT_BYTES`, the limit in `warn` mode is 33554432 (32 MiB). The default mode is `enforce`; any other value is ignored with a warning.

### Development

- For linting Dockerfile: install [hadolint](https://github.com/hadolint/hadolint/tree/master#install) and enable the hadolint VSCode extension
