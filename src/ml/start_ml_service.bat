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
    echo Please install Python 3.11 or 3.12 from https://www.python.org/downloads/
    echo.
    echo Recommended: Python 3.12.x
    pause
    exit /b 1
)

echo Python version:
python --version
echo.

REM Warn about Python 3.14+ compatibility
for /f "tokens=2" %%i in ('python --version 2^>^&1') do set PYTHON_VERSION=%%i
echo %PYTHON_VERSION% | findstr /R "^3\.14" >nul
if not errorlevel 1 (
    echo WARNING: Python 3.14 detected - some packages may not have pre-built wheels yet
    echo Recommended: Python 3.11 or 3.12 for better compatibility
    echo.
    echo If installation fails, please:
    echo   1. Download Python 3.12.x from https://www.python.org/downloads/
    echo   2. Uninstall Python 3.14
    echo   3. Install Python 3.12
    echo   4. Run this script again
    echo.
    pause
)

REM Check if virtual environment exists
if not exist "venv" (
    echo Virtual environment not found, creating...
    python -m venv venv
    if errorlevel 1 (
        echo Failed to create virtual environment
        pause
        exit /b 1
    )
    echo Virtual environment created
)

REM Activate virtual environment
echo Activating virtual environment...
call venv\Scripts\activate.bat

REM Install/upgrade dependencies
echo.
echo Installing Python dependencies...
echo This may take a few minutes on first run...
python -m pip install --upgrade pip >nul 2>&1
pip install -r requirements.txt

REM Check if installation succeeded
if errorlevel 1 (
    echo.
    echo ERROR: Failed to install dependencies
    echo.
    echo Common solutions:
    echo   1. Use Python 3.11 or 3.12 instead of 3.14
    echo   2. Install Visual C++ Build Tools if building from source
    echo   3. Check your internet connection
    echo.
    echo For Windows users with Python 3.14:
    echo   Download Python 3.12.x from https://www.python.org/downloads/
    echo   Uninstall Python 3.14, then install 3.12
    echo.
    pause
    exit /b 1
)

echo.
echo Dependencies installed successfully
echo.

REM Create necessary directories
if not exist "models" mkdir models
if not exist "data" mkdir data

REM Check if models exist
if not exist "models\*.json" (
    echo WARNING: No trained models found
    echo The service will start but predictions will fail until you train a model.
    echo To train a model:
    echo   1. Let the bot run and collect training data
    echo   2. Run: python train.py
    echo   3. Or trigger training via ML scheduler (if enabled)
    echo.
)

REM Start ML service
echo Starting FastAPI ML service...
echo Service URL: http://127.0.0.1:8001
echo API docs: http://127.0.0.1:8001/docs
echo Press Ctrl+C to stop
echo.

REM Start uvicorn
python ml_service.py
