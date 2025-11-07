# nof1.ai ML Service

XGBoost-powered machine learning prediction service for cryptocurrency trading.

## Python Version Requirements

**Recommended:** Python 3.11.x or 3.12.x

**Supported:** Python 3.11 - 3.13

**Not Recommended:** Python 3.14+ (too new, some packages may not have pre-built wheels)

### Why Python 3.11 or 3.12?

- ✅ All ML packages have pre-built wheels (fast installation)
- ✅ No C++ compiler required
- ✅ Tested and stable
- ✅ Best compatibility across all dependencies

### Python 3.14 Issues

Python 3.14.0 is very new (released recently), and some packages like `scikit-learn` don't have pre-built wheels yet. This means:

- ❌ Installation requires building from source
- ❌ Requires Visual C++ Build Tools on Windows
- ❌ Installation takes much longer (10-30 minutes)
- ❌ May fail with cryptic compiler errors

## Quick Start

### 1. Install Python (if needed)

**Download Python 3.12.x from:** https://www.python.org/downloads/

**Windows Installation:**
- Check "Add Python to PATH" during installation
- Restart your terminal after installation

**Verify installation:**
```cmd
python --version
```

Should show: `Python 3.12.x`

### 2. Start ML Service

**Windows (Command Prompt):**
```cmd
cd src\ml
start_ml_service.bat
```

**Windows (PowerShell):**
```powershell
cd src\ml
.\start_ml_service.ps1
```

**Linux/macOS:**
```bash
cd src/ml
./start_ml_service.sh
```

### 3. Verify Service

Open browser: http://127.0.0.1:8001/docs

Or test with curl:
```bash
curl http://127.0.0.1:8001/health
```

Expected response:
```json
{
  "status": "healthy",
  "model_loaded": false,
  "feature_count": 60,
  "uptime_seconds": 5.2
}
```

## Troubleshooting

### Problem: Python 3.14 Installation Fails

**Error:** `scikit-learn` build fails with compiler errors

**Solution:** Install Python 3.12 instead

1. Download Python 3.12.x from https://www.python.org/downloads/
2. Uninstall Python 3.14 (Settings → Apps → Python 3.14 → Uninstall)
3. Install Python 3.12
4. **Important:** Check "Add Python to PATH"
5. Restart terminal
6. Run `start_ml_service.bat` again

### Problem: "python is not recognized"

**Error:** `'python' is not recognized as an internal or external command`

**Solution:**

1. Add Python to PATH:
   - Search "Environment Variables" in Windows
   - Click "Environment Variables"
   - Under "User variables", edit "Path"
   - Add: `C:\Users\<YourName>\AppData\Local\Programs\Python\Python312`
   - Add: `C:\Users\<YourName>\AppData\Local\Programs\Python\Python312\Scripts`
2. Restart terminal
3. Test: `python --version`

### Problem: PowerShell Execution Policy

**Error:** `cannot be loaded because running scripts is disabled`

**Solution:**
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

Then run the script again:
```powershell
.\start_ml_service.ps1
```

### Problem: Module Not Found

**Error:** `ModuleNotFoundError: No module named 'numpy'`

**Cause:** Dependencies failed to install

**Solution:**

1. Delete `venv` folder
2. Run startup script again
3. If still fails, check Python version (should be 3.11 or 3.12)

### Problem: Port Already in Use

**Error:** `Address already in use: 127.0.0.1:8001`

**Solution:**

**Windows:**
```cmd
netstat -ano | findstr :8001
taskkill /PID <PID> /F
```

**Linux/macOS:**
```bash
lsof -i :8001
kill -9 <PID>
```

## Manual Installation

If automatic script fails, install manually:

```cmd
cd src\ml
python -m venv venv
venv\Scripts\activate
python -m pip install --upgrade pip
pip install -r requirements.txt
python ml_service.py
```

## Dependencies

The service requires:

- FastAPI (web framework)
- uvicorn (ASGI server)
- XGBoost (ML model)
- scikit-learn (ML utilities)
- numpy (numerical computing)
- pandas (data manipulation)

All dependencies are installed automatically by the startup script.

## Training a Model

See `docs/ML_INTEGRATION.md` for complete training workflow.

**Quick training:**
```cmd
cd src\ml
python train.py
```

Requires:
- At least 10,000 labeled training samples
- `src/ml/data/training_data.csv` file

## File Structure

```
src/ml/
├── ml_service.py           # FastAPI service (main)
├── train.py                # Training script
├── requirements.txt        # Python dependencies
├── start_ml_service.bat    # Windows CMD startup
├── start_ml_service.ps1    # Windows PowerShell startup
├── start_ml_service.sh     # Linux/macOS startup
├── models/                 # Trained model files
└── data/                   # Training data
```

## Performance

- **Installation:** 1-3 minutes (with Python 3.12)
- **First startup:** 30 seconds
- **Subsequent startups:** 5 seconds
- **Training time:** 2-5 minutes (10k samples)
- **Inference latency:** 1-5ms per prediction

## Support

For issues or questions:

1. Check `docs/ML_INTEGRATION.md` for detailed documentation
2. Ensure using Python 3.11 or 3.12
3. Check error messages in terminal
4. Verify firewall allows port 8001

## License

AGPL-3.0 - See LICENSE file
