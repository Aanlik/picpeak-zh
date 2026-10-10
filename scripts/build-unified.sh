#!/bin/sh
set -eu
repo_root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
image=${STACK_IMAGE:-picpeak-pixcake:3.134.1-zh.23-bridge.0.1.11}
docker build --platform "${PLATFORM:-linux/amd64}" -f "$repo_root/Dockerfile" -t "$image" "$repo_root"
