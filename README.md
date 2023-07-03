# Braekhus
Braekhus is a NAT hole-punching HTTP reverse proxy. It allows you to send encrypted web traffic to a server on a private network, from the Internet, without altering firewall settings.

The target server must be able to send requests out from the private network, e.g. via a NAT Gateway.

## Development
### Running locally
1. Run a target service that HTTP requests will be forwarded to. An easy way is with python: `python3 -m http.server 8000` - this will serve the contents of the folder where the command runs.
2. Run the server in `ts` folder: `yarn start:dev:server --rpcPort 8080 --proxyPort 8081`
3. Run the client in `ts` folder: `yarn start:dev:client --targetUrl http://localhost:8000 --clientId myClientId --tunnelHost localhost --tunnelPort 8080 --insecure true`

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

### Development
- For linting Dockerfile: install [hadolint](https://github.com/hadolint/hadolint/tree/master#install) and enable the hadolint VSCode extension
