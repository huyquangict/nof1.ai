# Start ML Service Script for Windows (PowerShell)
# Starts the FastAPI ML service for trading predictions

Write-Host "========================================" -ForegroundColor Green
Write-Host "Starting nof1.ai ML Service" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green

# Get script directory
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

# Check if Python is installed
try {
    $pythonVersion = python --version 2>&1
    Write-Host "Python version: $pythonVersion" -ForegroundColor Green
} catch {
    Write-Host "Error: Python is not installed" -ForegroundColor Red
    Write-Host "Please install Python 3.8 or higher from https://www.python.org/downloads/"
    Read-Host "Press Enter to exit"
    exit 1
}

# Check if virtual environment exists
if (-not (Test-Path "venv")) {
    Write-Host "Virtual environment not found, creating..." -ForegroundColor Yellow
    python -m venv venv
    Write-Host "Virtual environment created" -ForegroundColor Green
}

# Activate virtual environment
Write-Host "Activating virtual environment..."
& ".\venv\Scripts\Activate.ps1"

# Install/upgrade dependencies
Write-Host ""
Write-Host "Installing Python dependencies..." -ForegroundColor Yellow
python -m pip install --upgrade pip | Out-Null
pip install -r requirements.txt

Write-Host "Dependencies installed" -ForegroundColor Green

# Create necessary directories
if (-not (Test-Path "models")) {
    New-Item -ItemType Directory -Path "models" | Out-Null
}
if (-not (Test-Path "data")) {
    New-Item -ItemType Directory -Path "data" | Out-Null
}

# Check if models exist
$modelFiles = Get-ChildItem -Path "models" -Filter "*.json" -ErrorAction SilentlyContinue
if ($modelFiles.Count -eq 0) {
    Write-Host ""
    Write-Host "WARNING: No trained models found" -ForegroundColor Yellow
    Write-Host "The service will start but predictions will fail until you train a model."
    Write-Host "To train a model:"
    Write-Host "  1. Let the bot run and collect training data"
    Write-Host "  2. Run: python train.py"
    Write-Host "  3. Or trigger training via ML scheduler (if enabled)"
    Write-Host ""
}

# Start ML service
Write-Host ""
Write-Host "Starting FastAPI ML service..." -ForegroundColor Green
Write-Host "Service URL: http://127.0.0.1:8001"
Write-Host "API docs: http://127.0.0.1:8001/docs"
Write-Host "Press Ctrl+C to stop" -ForegroundColor Yellow
Write-Host ""

# Start uvicorn
python ml_service.py
