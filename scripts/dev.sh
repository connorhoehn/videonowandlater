#!/bin/bash

# dev.sh - Development server startup with configuration verification
# Ensures AWS configuration is valid before starting the webapp

set -e

# Colors for output (using tput if available, fallback to ANSI codes)
if command -v tput &> /dev/null && [ -t 1 ]; then
    RED=$(tput setaf 1)
    GREEN=$(tput setaf 2)
    YELLOW=$(tput setaf 3)
    BLUE=$(tput setaf 4)
    MAGENTA=$(tput setaf 5)
    CYAN=$(tput setaf 6)
    BOLD=$(tput bold)
    NC=$(tput sgr0)
else
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    BLUE='\033[0;34m'
    MAGENTA='\033[0;35m'
    CYAN='\033[0;36m'
    BOLD='\033[1m'
    NC='\033[0m'
fi

# Clear screen for clean output
clear

echo -e "${CYAN}${BOLD}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "     VideoNowAndLater Development Server      "
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${NC}"

# Check configuration
echo -e "${BLUE}🔍 Checking AWS configuration...${NC}"
echo ""

if ./scripts/verify-config.sh; then
    # Configuration is valid, extract details for display
    AWS_CONFIG="web/public/aws-config.json"
    API_URL=$(jq -r '.apiUrl' "$AWS_CONFIG" 2>/dev/null)
    REGION=$(jq -r '.region' "$AWS_CONFIG" 2>/dev/null)
    USER_POOL_ID=$(jq -r '.userPoolId' "$AWS_CONFIG" 2>/dev/null)

    echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}${BOLD}✅ Ready to start development server${NC}"
    echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo -e "${MAGENTA}🌐 Connected to AWS:${NC}"
    echo -e "   ${CYAN}API:${NC}        $API_URL"
    echo -e "   ${CYAN}Region:${NC}     $REGION"
    echo -e "   ${CYAN}User Pool:${NC}  ${USER_POOL_ID:0:20}..."
    echo ""
    echo -e "${YELLOW}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}${BOLD}🚀 Starting Vite development server...${NC}"
    echo -e "${YELLOW}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""

    # Start the dev server
    cd web && npm run dev
else
    # Configuration is missing or invalid
    echo ""
    echo -e "${RED}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${RED}${BOLD}⚠️  AWS configuration is missing or invalid${NC}"
    echo -e "${RED}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo -e "${YELLOW}The webapp requires AWS configuration to connect to backend services.${NC}"
    echo ""

    # Ask if user wants to deploy
    echo -e "${CYAN}Would you like to deploy the infrastructure now? (y/N)${NC}"
    read -r -p "➤ " DEPLOY_CHOICE

    if [[ "$DEPLOY_CHOICE" =~ ^[Yy]$ ]]; then
        echo ""
        echo -e "${BLUE}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "${BLUE}${BOLD}🏗️  Running deployment...${NC}"
        echo -e "${BLUE}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo ""

        # Run deployment
        npm run deploy

        echo ""
        echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "${GREEN}${BOLD}✅ Deployment complete!${NC}"
        echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo ""

        # Re-verify configuration
        if ./scripts/verify-config.sh; then
            # Extract details again
            AWS_CONFIG="web/public/aws-config.json"
            API_URL=$(jq -r '.apiUrl' "$AWS_CONFIG" 2>/dev/null)
            REGION=$(jq -r '.region' "$AWS_CONFIG" 2>/dev/null)
            USER_POOL_ID=$(jq -r '.userPoolId' "$AWS_CONFIG" 2>/dev/null)

            echo -e "${MAGENTA}🌐 Connected to AWS:${NC}"
            echo -e "   ${CYAN}API:${NC}        $API_URL"
            echo -e "   ${CYAN}Region:${NC}     $REGION"
            echo -e "   ${CYAN}User Pool:${NC}  ${USER_POOL_ID:0:20}..."
            echo ""
            echo -e "${YELLOW}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
            echo -e "${YELLOW}${BOLD}🚀 Starting Vite development server...${NC}"
            echo -e "${YELLOW}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
            echo ""

            # Start the dev server
            cd web && npm run dev
        else
            echo -e "${RED}${BOLD}❌ Configuration still invalid after deployment${NC}"
            echo -e "${RED}Please check the deployment logs for errors.${NC}"
            exit 1
        fi
    else
        echo ""
        echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "${YELLOW}ℹ️  To start the dev server, you need to:${NC}"
        echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo ""
        echo "  1. Deploy the infrastructure:"
        echo -e "     ${CYAN}npm run deploy${NC}"
        echo ""
        echo "  2. Then start the dev server:"
        echo -e "     ${CYAN}npm run dev${NC}"
        echo ""
        echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        exit 1
    fi
fi