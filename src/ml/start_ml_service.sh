#!/bin/bash
#
# Start ML Service Script
# Starts the FastAPI ML service for trading predictions
#

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Starting nof1.ai ML Service${NC}"
echo -e "${GREEN}========================================${NC}"

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Check if Python 3 is installed
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}Error: Python 3 is not installed${NC}"
    echo "Please install Python 3.8 or higher"
    exit 1
fi

PYTHON_VERSION=$(python3 --version 2>&1 | awk '{print $2}')
echo -e "Python version: ${GREEN}$PYTHON_VERSION${NC}"

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo -e "${YELLOW}Virtual environment not found, creating...${NC}"
    python3 -m venv venv
    echo -e "${GREEN}✓ Virtual environment created${NC}"
fi

# Activate virtual environment
echo "Activating virtual environment..."
source venv/bin/activate

# Install/upgrade dependencies
echo -e "\n${YELLOW}Installing Python dependencies...${NC}"
pip install --upgrade pip > /dev/null 2>&1
pip install -r requirements.txt

echo -e "${GREEN}✓ Dependencies installed${NC}"

# Create necessary directories
mkdir -p models data

# Check if models exist
if [ ! "$(ls -A models/*.json 2>/dev/null)" ]; then
    echo -e "\n${YELLOW}⚠️  No trained models found${NC}"
    echo "The service will start but predictions will fail until you train a model."
    echo "To train a model:"
    echo "  1. Let the bot run and collect training data"
    echo "  2. Run: python train.py"
    echo "  3. Or trigger training via ML scheduler (if enabled)"
fi

# Start ML service
echo -e "\n${GREEN}Starting FastAPI ML service...${NC}"
echo "Service URL: http://127.0.0.1:8001"
echo "API docs: http://127.0.0.1:8001/docs"
echo -e "${YELLOW}Press Ctrl+C to stop${NC}\n"

# Start uvicorn
python3 ml_service.py
