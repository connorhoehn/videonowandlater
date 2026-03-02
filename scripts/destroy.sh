#!/usr/bin/env bash
# scripts/destroy.sh
# Destroys all CDK stacks and removes generated config files

set -euo pipefail

echo "Destroying CDK stacks..."
npx cdk destroy --all --force

echo "Cleaning up generated config..."
rm -f cdk-outputs.json
rm -f web/public/aws-config.json

echo "Destroy complete."
