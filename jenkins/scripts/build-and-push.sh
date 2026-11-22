#!/bin/sh
set -e

SERVICE_NAME=$1
IMAGE_TAG=$2
REGISTRY=$3

if [ -z "$SERVICE_NAME" ] || [ -z "$IMAGE_TAG" ]; then
  echo "Usage: $0 <service_name> <image_tag> [registry]"
  exit 1
fi

DOCKERFILE="services/${SERVICE_NAME}/Dockerfile"
if [ "$SERVICE_NAME" = "frontend" ]; then
  DOCKERFILE="frontend/Dockerfile"
fi

DESTINATION="ecommerce-${SERVICE_NAME}:${IMAGE_TAG}"
if [ -n "$REGISTRY" ]; then
  DESTINATION="${REGISTRY}/${DESTINATION}"
fi

echo "==> Building and pushing ${DESTINATION} via Kaniko..."
/kaniko/executor \
  --context=dir://. \
  --dockerfile="${DOCKERFILE}" \
  --destination="${DESTINATION}" \
  --cache=true \
  --cache-dir=/tmp/cache
