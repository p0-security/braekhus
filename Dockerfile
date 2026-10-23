# Build this file with buildx on a Mac for deployment on Linux VMs:
# docker buildx build --load --platform linux/amd64 -t p0/kube-diver:latest .

# See
# source: https://github.com/nodejs/docker-node/blob/main/24/bookworm/Dockerfile
# best practices: https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md

# Build on the full Node image. Publish on Chainguard's slim Node runtime,
# which ships Node, glibc, and Node's libraries and nothing else: no apt, perl,
# GnuTLS, acl, npm, or busybox. The published runtime is Node 24.22.1.
#
# Why this base: the published image is mirrored into p0-prod Artifact
# Registry and Vanta reports every finding Artifact Analysis sees there,
# fixable or not. Debian-based images always carry glibc entries Debian will
# not fix; the Chainguard slim image scans at zero and Chainguard patches it
# on their side. The full Chainguard node image includes npm, which brings an
# unfixable npm dependency finding, so the slim variant is the one to use.
#
# The runtime has no shell, so every RUN step lives in the build stage and the
# runtime stage is COPY only. Pulling cgr.dev needs Chainguard auth, which CI
# gets keylessly from the p0-security-github OIDC identity (see docker.yaml).
# Locally, `chainctl auth login` then `chainctl auth configure-docker`.
ARG BUILD_BASE=node:24-bookworm@sha256:3d27e5c11e5786e309ec3e03f93ae536eb36e6e5eb3714d5eb3300a36157add0
ARG RUN_BASE=cgr.dev/p0.dev/node:24.22.1-slim@sha256:73a0566416c83f797f3f1125bcfa05eb21bf75f7fa12547276948a0fb707837b
FROM ${BUILD_BASE} AS build
RUN corepack enable yarn && corepack prepare yarn@4.9.4 --activate

WORKDIR /usr/src/app
COPY .yarn.lock yarn.lock
COPY package.json .yarnrc.yml ./
COPY ./packages/braekhus/package.json ./packages/braekhus/
RUN yarn install --immutable && yarn cache clean


# Copy tsconfig.json and source files
# It is very important to exclude node_modules folder from these COPY commands with .dockerignore.
# Otherwise the node_modules folder created in the previous step with yarn install will be overwritten.
COPY . ./
WORKDIR /usr/src/app/packages/braekhus
RUN yarn build

# Prune dev dependencies in place so the node_modules carried into the deploy
# stage is production-only -- no second install.
RUN yarn workspaces focus @p0security/braekhus --production && yarn cache clean

# Yarn 4 is a single JS file. Stage the release Corepack prepared above next to
# the app so the runtime can start it with node (there is no corepack there).
RUN cp /root/.cache/node/corepack/v1/yarn/4.9.4/yarn.js /usr/src/app/yarn.js

# node-jq downloads jq 1.7.1 at install time and no node-jq release ships a
# newer one. The scanners flag that binary, so fetch the current jq release
# instead, pinned by digest for each architecture, and drop the bundled copy.
# node-jq reads JQ_PATH at startup, set on the runtime stage below.
ARG TARGETARCH
ARG JQ_VERSION=1.8.2
ARG JQ_SHA256_AMD64=b1c22172dd303f3be49e935aa56aa48a8b7a46e0bc838b4997d3bb451495870f
ARG JQ_SHA256_ARM64=8b85c817833814ddca00a144c33705546355afccf0cf39b188f3cdb48b852309
RUN curl -fsSLo /usr/local/bin/jq \
    "https://github.com/jqlang/jq/releases/download/jq-${JQ_VERSION}/jq-linux-${TARGETARCH}" \
  && case "${TARGETARCH}" in \
       amd64) echo "${JQ_SHA256_AMD64}  /usr/local/bin/jq" | sha256sum -c - ;; \
       arm64) echo "${JQ_SHA256_ARM64}  /usr/local/bin/jq" | sha256sum -c - ;; \
       *) echo "unsupported TARGETARCH ${TARGETARCH}" && exit 1 ;; \
     esac \
  && chmod 0755 /usr/local/bin/jq \
  && rm -f /usr/src/app/node_modules/node-jq/bin/jq

# Deploy stage: hardened runtime. Carry over the built app from the build stage,
# production node_modules plus the compiled dist, instead of reinstalling.
# node-jq's jq binary is in those node_modules, so it must survive this copy.
FROM ${RUN_BASE} AS run

# The base defaults to uid 65532, but the published image has always
# run as root and customer deployments depend on it: the Kubernetes manifest
# mounts /p0-files from a PersistentVolumeClaim with no fsGroup, and the client
# stores its private key there as root with mode 0400. A non-root process could
# neither read an existing key nor create one, so moving off root is a
# coordinated manifest change, not something :latest can do on its own.
USER 0
WORKDIR /usr/src/app
COPY --from=build /usr/src/app ./

# The P0 install page has customers read the public key with
# `kubectl exec ... -- cat /p0-files/jwk.public.json`. The slim base has no
# coreutils, so carry cat over from the build stage. It links only libc, which
# the runtime already ships.
COPY --from=build /bin/cat /bin/cat

# Current jq for node-jq (see the build stage).
COPY --from=build /usr/local/bin/jq /usr/local/bin/jq
ENV JQ_PATH=/usr/local/bin/jq

# Customer manifests pass a script name such as start:prod:client, so the
# entrypoint stays Yarn. Running the bundle with node keeps that contract on an
# image with no yarn binary. Yarn's own script runner also needs no /bin/sh.
WORKDIR /usr/src/app/packages/braekhus
ENTRYPOINT ["node", "/usr/src/app/yarn.js"]
