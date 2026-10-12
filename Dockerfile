# Build this file with buildx on a Mac for deployment on Linux VMs:
# docker buildx build --load --platform linux/amd64 -t p0/kube-diver:latest .

# See
# source: https://github.com/nodejs/docker-node/blob/main/24/bookworm/Dockerfile
# best practices: https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md

# Build on the full image. The published stage is slim so the runtime image
# does not ship ImageMagick, compilers, or -dev packages.
# Node 24.21.0 is the current 24 release (Node 18 is EOL). These digests are
# the 2026-10-06 library/node rebuilds of that release.
ARG BUILD_BASE=node:24-bookworm@sha256:3d27e5c11e5786e309ec3e03f93ae536eb36e6e5eb3714d5eb3300a36157add0
ARG RUN_BASE=node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
FROM ${BUILD_BASE} AS build
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

# Deploy stage: slim base. Carry over the built app from the build stage,
# production node_modules plus the compiled dist, instead of reinstalling.
# node-jq's jq binary is in those node_modules, so it must survive this copy.
FROM ${RUN_BASE} AS run
# The Node image still carries perl 5.36.0-7+deb12u3. deb12u4 is in
# bookworm-security and clears CVE-2026-57433, CVE-2026-42496, CVE-2026-13221,
# CVE-2026-8376, and CVE-2026-12087. libgnutls30 and libacl1 have no bookworm
# fix yet, so they stay.
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y \
  && rm -rf /var/lib/apt/lists/*

# npm inside this Node release vendors undici 6.27.0. CVE-2026-19534 is fixed
# in 6.28.1, and no newer Node 24 image publishes that. The app does not import
# this copy. Yarn is the entrypoint.
RUN cd /tmp \
  && npm pack undici@6.29.0 --silent >/dev/null \
  && rm -rf /usr/local/lib/node_modules/npm/node_modules/undici \
  && tar -xzf undici-6.29.0.tgz -C /usr/local/lib/node_modules/npm/node_modules \
  && mv /usr/local/lib/node_modules/npm/node_modules/package \
    /usr/local/lib/node_modules/npm/node_modules/undici \
  && rm undici-6.29.0.tgz

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
