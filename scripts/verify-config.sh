#!/bin/bash

# verify-config.sh - AWS configuration verification script
# Checks that the webapp has proper AWS configuration before starting dev server

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration paths
CDK_OUTPUTS="cdk-outputs.json"
AWS_CONFIG="web/public/aws-config.json"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔍 Verifying AWS Configuration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check for CDK outputs
if [ ! -f "$CDK_OUTPUTS" ]; then
    echo -e "${RED}❌ CDK outputs not found${NC}"
    echo "   Missing: $CDK_OUTPUTS"
    echo ""
    echo -e "${YELLOW}⚠️  Infrastructure not deployed${NC}"
    echo "   Run: npm run deploy"
    echo ""
    exit 1
fi

echo -e "${GREEN}✓${NC} CDK outputs found"

# Check for AWS config file
if [ ! -f "$AWS_CONFIG" ]; then
    echo -e "${RED}❌ AWS configuration not found${NC}"
    echo "   Missing: $AWS_CONFIG"
    echo ""
    echo -e "${YELLOW}⚠️  Configuration not generated${NC}"
    echo "   Run: npm run deploy"
    echo ""
    exit 1
fi

echo -e "${GREEN}✓${NC} AWS configuration found"

# Validate JSON format
if ! jq empty "$AWS_CONFIG" 2>/dev/null; then
    echo -e "${RED}❌ Invalid JSON in configuration${NC}"
    echo "   File: $AWS_CONFIG"
    echo ""
    echo -e "${YELLOW}⚠️  Configuration is corrupted${NC}"
    echo "   Run: npm run deploy to regenerate"
    echo ""
    exit 1
fi

echo -e "${GREEN}✓${NC} Configuration is valid JSON"

# Check required fields
REQUIRED_FIELDS=("userPoolId" "userPoolClientId" "region" "apiUrl")
MISSING_FIELDS=()

for field in "${REQUIRED_FIELDS[@]}"; do
    VALUE=$(jq -r ".$field" "$AWS_CONFIG" 2>/dev/null)
    if [ "$VALUE" == "null" ] || [ -z "$VALUE" ]; then
        MISSING_FIELDS+=("$field")
    fi
done

if [ ${#MISSING_FIELDS[@]} -gt 0 ]; then
    echo -e "${RED}❌ Missing required configuration fields${NC}"
    for field in "${MISSING_FIELDS[@]}"; do
        echo "   - $field"
    done
    echo ""
    echo -e "${YELLOW}⚠️  Configuration is incomplete${NC}"
    echo "   Run: npm run deploy to regenerate"
    echo ""
    exit 1
fi

echo -e "${GREEN}✓${NC} All required fields present"

# Display configuration
echo ""
echo "📋 Configuration Details:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

USER_POOL_ID=$(jq -r '.userPoolId' "$AWS_CONFIG")
CLIENT_ID=$(jq -r '.userPoolClientId' "$AWS_CONFIG")
REGION=$(jq -r '.region' "$AWS_CONFIG")
API_URL=$(jq -r '.apiUrl' "$AWS_CONFIG")

echo "   Region:        $REGION"
echo "   User Pool ID:  ${USER_POOL_ID:0:20}..."
echo "   Client ID:     ${CLIENT_ID:0:20}..."
echo "   API URL:       $API_URL"

# Test API connectivity (optional - only if curl is available)
if command -v curl &> /dev/null; then
    echo ""
    echo "🌐 Testing API connectivity..."

    # Test the API health endpoint (assuming /health exists)
    # We'll do a simple HEAD request to check if the API is reachable
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "$API_URL" 2>/dev/null || echo "000")

    if [ "$HTTP_CODE" == "000" ]; then
        echo -e "${YELLOW}⚠️  API is not reachable${NC}"
        echo "   This might be normal if the API requires authentication"
    elif [ "$HTTP_CODE" == "403" ] || [ "$HTTP_CODE" == "401" ]; then
        echo -e "${GREEN}✓${NC} API is reachable (authentication required)"
    elif [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 500 ]; then
        echo -e "${GREEN}✓${NC} API is reachable (HTTP $HTTP_CODE)"
    else
        echo -e "${YELLOW}⚠️  API returned HTTP $HTTP_CODE${NC}"
    fi
fi

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ Configuration verified successfully${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

exit 0