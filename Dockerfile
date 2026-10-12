# Build this file with buildx on a Mac for deployment on Linux VMs:
# docker buildx build --load --platform linux/amd64 -t p0/kube-diver:latest .

# See
# source: https://github.com/nodejs/docker-node/blob/main/24/bookworm/Dockerfile
# best practices: https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md

# Build on the full Node image. Publish on the Docker Hardened Images runtime,
# which ships only Node and its libc, so there is no apt, perl, GnuTLS, or acl
# for the scan to report. Both are Node 24.21.0 (Node 18 is EOL).
#
# The runtime has no shell, so every RUN step lives in the build stage and the
# runtime stage is COPY only. Pulling dhi.io needs `docker login dhi.io`, which
# CI does with the p0security organization access token.
ARG BUILD_BASE=node:24-bookworm@sha256:3d27e5c11e5786e309ec3e03f93ae536eb36e6e5eb3714d5eb3300a36157add0
ARG RUN_BASE=dhi.io/node:24.21.0-debian13@sha256:f3575cf1e68ffe163703b691c465af833fd2d94cccc1e825d052c943018f2aa3
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

# Deploy stage: hardened runtime. Carry over the built app from the build stage,
# production node_modules plus the compiled dist, instead of reinstalling.
# node-jq's jq binary is in those node_modules, so it must survive this copy.
FROM ${RUN_BASE} AS run

# The hardened base defaults to uid 1000, but the published image has always
# run as root and customer deployments depend on it: the Kubernetes manifest
# mounts /p0-files from a PersistentVolumeClaim with no fsGroup, and the client
# stores its private key there as root with mode 0400. A non-root process could
# neither read an existing key nor create one, so moving off root is a
# coordinated manifest change, not something :latest can do on its own.
USER 0
WORKDIR /usr/src/app
COPY --from=build /usr/src/app ./

# Customer manifests pass a script name such as start:prod:client, so the
# entrypoint stays Yarn. Running the bundle with node keeps that contract on an
# image with no yarn binary. Yarn's own script runner also needs no /bin/sh.
WORKDIR /usr/src/app/packages/braekhus
ENTRYPOINT ["node", "/usr/src/app/yarn.js"]
