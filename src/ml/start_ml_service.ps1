# Start ML Service Script for Windows (PowerShell)
# Starts the FastAPI ML service for trading predictions

Write-Host "========================================" -ForegroundColor Green
Write-Host "Starting nof1.ai ML Service" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

# Get script directory
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

# Check if Python is installed
try {
    $pythonVersionOutput = python --version 2>&1 | Out-String
    $pythonVersionOutput = $pythonVersionOutput.Trim()
    Write-Host "Python version: $pythonVersionOutput" -ForegroundColor Green

    # Check if Python 3.14+
    if ($pythonVersionOutput -match "Python 3\.14") {
        Write-Host ""
        Write-Host "WARNING: Python 3.14 detected - some packages may not have pre-built wheels yet" -ForegroundColor Yellow
        Write-Host "Recommended: Python 3.11 or 3.12 for better compatibility" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "If installation fails, please:" -ForegroundColor Yellow
        Write-Host "  1. Download Python 3.12.x from https://www.python.org/downloads/" -ForegroundColor Yellow
        Write-Host "  2. Uninstall Python 3.14" -ForegroundColor Yellow
        Write-Host "  3. Install Python 3.12" -ForegroundColor Yellow
        Write-Host "  4. Run this script again" -ForegroundColor Yellow
        Write-Host ""
        $continue = Read-Host "Continue anyway? (y/n)"
        if ($continue -ne "y") {
            exit 1
        }
    }
} catch {
    Write-Host "Error: Python is not installed" -ForegroundColor Red
    Write-Host "Please install Python 3.11 or 3.12 from https://www.python.org/downloads/"
    Write-Host ""
    Write-Host "Recommended: Python 3.12.x"
    Read-Host "Press Enter to exit"
    exit 1
}

# Check if virtual environment exists
if (-not (Test-Path "venv")) {
    Write-Host "Virtual environment not found, creating..." -ForegroundColor Yellow
    python -m venv venv
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Failed to create virtual environment" -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    }
    Write-Host "Virtual environment created" -ForegroundColor Green
}

# Activate virtual environment
Write-Host "Activating virtual environment..."
& ".\venv\Scripts\Activate.ps1"

# Install/upgrade dependencies
Write-Host ""
Write-Host "Installing Python dependencies..." -ForegroundColor Yellow
Write-Host "This may take a few minutes on first run..." -ForegroundColor Cyan
python -m pip install --upgrade pip | Out-Null
pip install -r requirements.txt

# Check if installation succeeded
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "ERROR: Failed to install dependencies" -ForegroundColor Red
    Write-Host ""
    Write-Host "Common solutions:" -ForegroundColor Yellow
    Write-Host "  1. Use Python 3.11 or 3.12 instead of 3.14" -ForegroundColor Yellow
    Write-Host "  2. Install Visual C++ Build Tools if building from source" -ForegroundColor Yellow
    Write-Host "  3. Check your internet connection" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "For Windows users with Python 3.14:" -ForegroundColor Cyan
    Write-Host "  Download Python 3.12.x from https://www.python.org/downloads/" -ForegroundColor Cyan
    Write-Host "  Uninstall Python 3.14, then install 3.12" -ForegroundColor Cyan
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host ""
Write-Host "Dependencies installed successfully" -ForegroundColor Green
Write-Host ""

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
    Write-Host "WARNING: No trained models found" -ForegroundColor Yellow
    Write-Host "The service will start but predictions will fail until you train a model."
    Write-Host "To train a model:"
    Write-Host "  1. Let the bot run and collect training data"
    Write-Host "  2. Run: python train.py"
    Write-Host "  3. Or trigger training via ML scheduler (if enabled)"
    Write-Host ""
}

# Start ML service
Write-Host "Starting FastAPI ML service..." -ForegroundColor Green
Write-Host "Service URL: http://127.0.0.1:8001"
Write-Host "API docs: http://127.0.0.1:8001/docs"
Write-Host "Press Ctrl+C to stop" -ForegroundColor Yellow
Write-Host ""

# Start uvicorn
python ml_service.py
