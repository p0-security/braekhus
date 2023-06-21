# Build this file with buildx on a Mac for deployment on Linux VMs:
# docker buildx build --load --platform linux/amd64 -t p0/kube-diver:latest .

FROM node:18.14.2-alpine3.17

WORKDIR ts

# Copy package.json and yarn.lock files
COPY ts/package.json ts/yarn.lock ./
RUN yarn install

# Copy tsconfig.json and source files
# It is very important to exclude node_modules folder from these COPY commands with .dockerignore.
# Otherwise the node_modules folder created in the previous step with yarn install will be overwritten.
COPY ts/ ./
RUN yarn build

ENTRYPOINT ["yarn"]
