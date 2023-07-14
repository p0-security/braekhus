This manifest parameterizes the tunnel and target parameters of the client. Example command to apply this manifest:

TARGET_URL=https://A5EF4.eks.amazonaws.com TUNNEL_HOST=myhost.com TUNNEL_PORT=443 DOCKER_REPO=accountid.dkr.ecr.region.amazonaws.com/p0/kube-diver DOCKER_IMAGE_TAG=latest envsubst < manifest.yaml | kubectl apply -f -
