# Build this file with buildx on a Mac for deployment on Linux VMs:
# docker buildx build --load --platform linux/amd64 -t p0/kube-diver:latest .

# See
# source: https://github.com/nodejs/docker-node/blob/0adf29a4daa744d828d23a8de4c4397dc43d5761/18/alpine3.17/Dockerfile
# best practices: https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md

FROM node:18.17-bookworm

WORKDIR /usr/src/app

# Copy package.json and yarn.lock files
COPY package.json yarn.lock ./
RUN yarn install && yarn cache clean

# Copy tsconfig.json and source files
# It is very important to exclude node_modules folder from these COPY commands with .dockerignore.
# Otherwise the node_modules folder created in the previous step with yarn install will be overwritten.
COPY . ./
RUN yarn build

ENTRYPOINT ["yarn"]
