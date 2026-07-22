# Build this file with buildx on a Mac for deployment on Linux VMs:
# docker buildx build --load --platform linux/amd64 -t p0/kube-diver:latest .

# See
# source: https://github.com/nodejs/docker-node/blob/main/24/bookworm/Dockerfile
# best practices: https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md

ARG BASE=node:24-bookworm@sha256:5711a0d445a1af54af9589066c646df387d1831a608226f4cd694fc59e745059
FROM ${BASE} AS build
RUN corepack enable yarn

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

# Deploy stage: same base, pinned once via ARG BASE (no FROM change). Carry over
# the built app from the build stage -- production node_modules plus the compiled
# dist -- instead of reinstalling.
FROM ${BASE} AS run
# Bake the Yarn release into the image at build time. The single COPY below carries
# the app but not Corepack's download cache, so a bare `corepack enable yarn` would
# make ENTRYPOINT ["yarn"] fetch Yarn from repo.yarnpkg.com on every container
# start (breaks in offline/egress-restricted deployments). `corepack prepare
# --activate` caches the exact version the build stage uses, so runtime is offline-safe.
RUN corepack enable yarn && corepack prepare yarn@4.9.4 --activate

WORKDIR /usr/src/app
COPY --from=build /usr/src/app ./

WORKDIR /usr/src/app/packages/braekhus
ENTRYPOINT ["yarn"]
