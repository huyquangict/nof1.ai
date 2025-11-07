@echo off
REM Start ML Service Script for Windows
REM Starts the FastAPI ML service for trading predictions

echo ========================================
echo Starting nof1.ai ML Service
echo ========================================

REM Get script directory
cd /d "%~dp0"

REM Check if Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo Error: Python is not installed
    echo Please install Python 3.8 or higher from https://www.python.org/downloads/
    pause
    exit /b 1
)

echo Python version:
python --version

REM Check if virtual environment exists
if not exist "venv" (
    echo Virtual environment not found, creating...
    python -m venv venv
    echo Virtual environment created
)

REM Activate virtual environment
echo Activating virtual environment...
call venv\Scripts\activate.bat

REM Install/upgrade dependencies
echo.
echo Installing Python dependencies...
python -m pip install --upgrade pip >nul 2>&1
pip install -r requirements.txt

echo Dependencies installed

REM Create necessary directories
if not exist "models" mkdir models
if not exist "data" mkdir data

REM Check if models exist
if not exist "models\*.json" (
    echo.
    echo WARNING: No trained models found
    echo The service will start but predictions will fail until you train a model.
    echo To train a model:
    echo   1. Let the bot run and collect training data
    echo   2. Run: python train.py
    echo   3. Or trigger training via ML scheduler (if enabled)
    echo.
)

REM Start ML service
echo.
echo Starting FastAPI ML service...
echo Service URL: http://127.0.0.1:8001
echo API docs: http://127.0.0.1:8001/docs
echo Press Ctrl+C to stop
echo.

REM Start uvicorn
python ml_service.py
