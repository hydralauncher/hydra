FROM node:22-alpine AS builder

# Install git (required for git dependencies)
RUN apk add --no-cache git

WORKDIR /app

COPY package.json yarn.lock ./

# Install dependencies but skip postinstall scripts (electron-builder deps not needed for web build)
RUN yarn install --frozen-lockfile --ignore-scripts

COPY . .

RUN yarn electron-vite build
