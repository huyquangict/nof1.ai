/**
 * open-nof1.ai - AI Cryptocurrency Automated Trading System
 * Copyright (C) 2025 195440
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

// AI Trading Monitor - Using Real API
class TradingMonitor {
    constructor() {
        this.cryptoPrices = new Map();
        this.accountData = null;
        this.equityChart = null;
        this.chartTimeframe = '24'; // Fixed to 24 hours
        this.token = localStorage.getItem('jwt_token');
        console.log('TradingMonitor constructor, token:', this.token ? 'exists' : 'none');

        // Allow clearing token via console: monitor.clearAuth()
        window.monitor = this;

        this.init();
    }

    clearAuth() {
        console.log('Clearing authentication');
        localStorage.removeItem('jwt_token');
        this.token = null;
        location.reload();
    }

    // Update connection status indicator
    updateConnectionStatus(status, message = '') {
        const statusEl = document.getElementById('connection-status');
        if (!statusEl) return;

        const dot = statusEl.querySelector('.status-dot');
        const text = statusEl.querySelector('.status-text');

        // Remove all status classes
        statusEl.classList.remove('status-connected', 'status-error', 'status-auth-required');

        switch (status) {
            case 'connected':
                statusEl.classList.add('status-connected');
                text.textContent = message || 'Connected';
                console.log('✅ Status: Connected');
                break;
            case 'error':
                statusEl.classList.add('status-error');
                text.textContent = message || 'Connection Error';
                console.error('❌ Status: Error -', message);
                break;
            case 'auth-required':
                statusEl.classList.add('status-auth-required');
                text.textContent = message || 'Login Required';
                console.warn('🔐 Status: Auth Required');
                break;
            default:
                text.textContent = message || 'Connecting...';
        }
    }

    async init() {
        console.log('Starting init, has token:', !!this.token);

        // If no token, show login immediately (no need to verify)
        if (!this.token) {
            console.log('No token, showing login form');
            this.updateConnectionStatus('auth-required');
            this.showLoginForm();
            return;
        }

        console.log('Token exists, attempting to load data');
        this.updateConnectionStatus('connecting', 'Loading data...');

        // If we have a token, try to load data (will redirect to login on 401)
        try {
            await this.loadInitialData();
            console.log('Data loaded successfully');
            this.updateConnectionStatus('connected');
            this.initEquityChart();
            this.initTimeframeSelector();
            this.startDataUpdates();
            this.initTabs();
            this.initChat();
            this.duplicateTicker();
            this.loadGitHubStars(); // Load GitHub star count
            this.initPauseButton(); // Initialize pause button
            this.initReverseButton(); // Initialize reverse button
            this.initCustomInstructions(); // Initialize custom instructions
            this.initTradingSettings(); // Initialize trading settings
            this.initLearningSystem(); // Initialize AI learning system
        } catch (error) {
            // If loading fails, token is invalid - show login
            console.error('Failed to load data:', error);
            console.log('Showing login form due to error');
            this.updateConnectionStatus('auth-required');
            this.showLoginForm();
        }
    }

    // Initialize pause button
    initPauseButton() {
        const pauseButton = document.getElementById('pause-button');
        if (!pauseButton) {
            console.error('Pause button not found');
            return;
        }

        // Load initial pause state
        this.loadPauseState();

        // Add click handler
        pauseButton.addEventListener('click', async () => {
            await this.togglePause();
        });

        // Refresh pause state every 30 seconds
        setInterval(() => {
            this.loadPauseState();
        }, 30000);
    }

    // Load pause state from API
    async loadPauseState() {
        try {
            const response = await fetch('/api/trading/pause');
            const data = await response.json();

            this.updatePauseButton(data.paused);
        } catch (error) {
            console.error('Failed to load pause state:', error);
        }
    }

    // Toggle pause state
    async togglePause() {
        const pauseButton = document.getElementById('pause-button');
        if (!pauseButton) return;

        const isPaused = pauseButton.classList.contains('paused');
        const newState = !isPaused;

        try {
            const response = await fetch('/api/trading/pause', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ paused: newState }),
            });

            const data = await response.json();

            if (data.success) {
                this.updatePauseButton(data.paused);
                console.log(data.message);

                // Show user notification
                const message = data.paused
                    ? '⏸️  Trading PAUSED - LLM will not open new positions'
                    : '▶️  Trading RESUMED - LLM can now open new positions';

                this.showNotification(message, data.paused ? 'warning' : 'success');
            } else {
                console.error('Failed to toggle pause:', data.error);
                alert(`Failed to toggle pause: ${data.error}`);
            }
        } catch (error) {
            console.error('Failed to toggle pause:', error);
            alert(`Failed to toggle pause: ${error.message}`);
        }
    }

    // Update pause button UI
    updatePauseButton(isPaused) {
        const pauseButton = document.getElementById('pause-button');
        const pauseText = pauseButton?.querySelector('.pause-text');

        if (!pauseButton || !pauseText) return;

        if (isPaused) {
            pauseButton.classList.add('paused');
            pauseText.textContent = 'PAUSED';
        } else {
            pauseButton.classList.remove('paused');
            pauseText.textContent = 'ACTIVE';
        }
    }

    // Show notification toast
    showNotification(message, type = 'info') {
        // Remove existing notification if any
        const existing = document.getElementById('pause-notification');
        if (existing) existing.remove();

        // Create notification element
        const notification = document.createElement('div');
        notification.id = 'pause-notification';
        notification.style.cssText = `
            position: fixed;
            top: 80px;
            right: 20px;
            padding: 16px 24px;
            background: ${type === 'warning' ? '#F97316' : '#10B981'};
            color: white;
            border: 3px solid #000;
            font-family: 'Inter', sans-serif;
            font-weight: 700;
            font-size: 14px;
            z-index: 10000;
            box-shadow: 4px 4px 0 rgba(0, 0, 0, 0.2);
            animation: slideIn 0.3s ease-out;
        `;
        notification.textContent = message;

        document.body.appendChild(notification);

        // Auto-remove after 5 seconds
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease-out';
            setTimeout(() => notification.remove(), 300);
        }, 5000);
    }

    // Initialize reverse button
    initReverseButton() {
        const reverseButton = document.getElementById('reverse-button');
        if (!reverseButton) {
            console.error('Reverse button not found');
            return;
        }

        // Load initial reverse state
        this.loadReverseState();

        // Add click handler
        reverseButton.addEventListener('click', async () => {
            await this.toggleReverse();
        });

        // Refresh reverse state every 30 seconds
        setInterval(() => {
            this.loadReverseState();
        }, 30000);
    }

    // Load reverse state from API
    async loadReverseState() {
        try {
            const response = await fetch('/api/trading/reverse');
            const data = await response.json();

            this.updateReverseButton(data.reversed);
        } catch (error) {
            console.error('Failed to load reverse state:', error);
        }
    }

    // Toggle reverse state
    async toggleReverse() {
        const reverseButton = document.getElementById('reverse-button');
        if (!reverseButton) return;

        const isReversed = reverseButton.classList.contains('reversed');
        const newState = !isReversed;

        try {
            const response = await fetch('/api/trading/reverse', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ reversed: newState }),
            });

            const data = await response.json();

            if (data.success) {
                this.updateReverseButton(data.reversed);
                console.log(data.message);

                // Show user notification
                const message = data.reversed
                    ? '🔄 Reverse mode ON - LLM LONG → System SHORT, LLM SHORT → System LONG'
                    : '✅ Reverse mode OFF - LLM decisions execute as-is';

                const notifType = data.reversed ? 'warning' : 'success';
                // Use different background color for reverse (purple)
                this.showReverseNotification(message, data.reversed);
            } else {
                console.error('Failed to toggle reverse:', data.error);
                alert(`Failed to toggle reverse: ${data.error}`);
            }
        } catch (error) {
            console.error('Failed to toggle reverse:', error);
            alert(`Failed to toggle reverse: ${error.message}`);
        }
    }

    // Update reverse button UI
    updateReverseButton(isReversed) {
        const reverseButton = document.getElementById('reverse-button');
        const reverseText = reverseButton?.querySelector('.reverse-text');

        if (!reverseButton || !reverseText) return;

        if (isReversed) {
            reverseButton.classList.add('reversed');
            reverseText.textContent = 'REVERSED';
        } else {
            reverseButton.classList.remove('reversed');
            reverseText.textContent = 'NORMAL';
        }
    }

    // Show reverse notification toast (purple for reversed)
    showReverseNotification(message, isReversed) {
        // Remove existing notification if any
        const existing = document.getElementById('pause-notification');
        if (existing) existing.remove();

        // Create notification element
        const notification = document.createElement('div');
        notification.id = 'pause-notification';
        notification.style.cssText = `
            position: fixed;
            top: 80px;
            right: 20px;
            padding: 16px 24px;
            background: ${isReversed ? '#A855F7' : '#10B981'};
            color: white;
            border: 3px solid #000;
            font-family: 'Inter', sans-serif;
            font-weight: 700;
            font-size: 14px;
            z-index: 10000;
            box-shadow: 4px 4px 0 rgba(0, 0, 0, 0.2);
            animation: slideIn 0.3s ease-out;
        `;
        notification.textContent = message;

        document.body.appendChild(notification);

        // Auto-remove after 5 seconds
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease-out';
            setTimeout(() => notification.remove(), 300);
        }, 5000);
    }

    // Initialize custom instructions
    initCustomInstructions() {
        const textarea = document.getElementById('custom-instructions');
        const saveButton = document.getElementById('save-instructions-button');

        if (!textarea || !saveButton) {
            console.error('Custom instructions elements not found');
            return;
        }

        // Load initial instructions
        this.loadCustomInstructions();

        // Add save button handler
        saveButton.addEventListener('click', async () => {
            await this.saveCustomInstructions();
        });

        // Optional: Auto-save on blur or after typing pause
        let saveTimeout;
        textarea.addEventListener('input', () => {
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(async () => {
                console.log('Auto-saving custom instructions...');
                await this.saveCustomInstructions(true); // true = silent save
            }, 3000); // Auto-save after 3 seconds of no typing
        });
    }

    // Load custom instructions from API
    async loadCustomInstructions() {
        try {
            const response = await fetch('/api/trading/custom-instructions');
            const data = await response.json();

            const textarea = document.getElementById('custom-instructions');
            if (textarea) {
                textarea.value = data.instructions || '';
            }
        } catch (error) {
            console.error('Failed to load custom instructions:', error);
        }
    }

    // Save custom instructions to API
    async saveCustomInstructions(silent = false) {
        const textarea = document.getElementById('custom-instructions');
        if (!textarea) return;

        const instructions = textarea.value.trim();

        try {
            const response = await fetch('/api/trading/custom-instructions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ instructions }),
            });

            const data = await response.json();

            if (data.success) {
                console.log(data.message);

                // Show user notification (unless silent save)
                if (!silent) {
                    const message = instructions
                        ? '💬 Custom instructions saved - will be included in next AI decision'
                        : '🗑️ Custom instructions cleared';

                    this.showNotification(message, 'success');
                }
            } else {
                console.error('Failed to save custom instructions:', data.error);
                if (!silent) {
                    alert(`Failed to save custom instructions: ${data.error}`);
                }
            }
        } catch (error) {
            console.error('Failed to save custom instructions:', error);
            if (!silent) {
                alert(`Failed to save custom instructions: ${error.message}`);
            }
        }
    }

    // Initialize trading settings
    initTradingSettings() {
        const saveButton = document.getElementById('save-settings-button');

        if (!saveButton) {
            console.error('Trading settings elements not found');
            return;
        }

        // Load initial settings
        this.loadTradingSettings();

        // Add save button handler
        saveButton.addEventListener('click', async () => {
            await this.saveTradingSettings();
        });
    }

    // Load trading settings from API
    async loadTradingSettings() {
        try {
            const response = await fetch('/api/trading/settings');
            const data = await response.json();

            if (data.error) {
                console.error('Failed to load trading settings:', data.error);
                return;
            }

            // Update trading symbols checkboxes
            if (data.tradingSymbols && Array.isArray(data.tradingSymbols)) {
                const enabledSymbols = new Set(data.tradingSymbols);

                // Update all coin checkboxes
                const allCoinOptions = document.querySelectorAll('.coin-option input[type="checkbox"]');
                allCoinOptions.forEach(checkbox => {
                    const symbol = checkbox.value;
                    if (enabledSymbols.has(symbol)) {
                        checkbox.checked = true;
                    } else {
                        checkbox.checked = false;
                    }
                });
            }

            // Update max positions select
            if (data.maxPositions !== undefined) {
                const maxPositionsSelect = document.getElementById('max-positions');
                if (maxPositionsSelect) {
                    maxPositionsSelect.value = data.maxPositions.toString();
                }
            }

            // Update settings badge
            this.updateSettingsBadge(data.tradingSymbols, data.maxPositions);

        } catch (error) {
            console.error('Failed to load trading settings:', error);
        }
    }

    // Save trading settings to API
    async saveTradingSettings() {
        const saveButton = document.getElementById('save-settings-button');
        if (!saveButton) return;

        try {
            // Get selected trading symbols
            const selectedCheckboxes = document.querySelectorAll('.coin-option input[type="checkbox"]:checked');
            const tradingSymbols = Array.from(selectedCheckboxes).map(checkbox => checkbox.value);

            // Get max positions
            const maxPositionsSelect = document.getElementById('max-positions');
            const maxPositions = maxPositionsSelect ? parseInt(maxPositionsSelect.value) : 5;

            // Validate selections
            if (tradingSymbols.length === 0) {
                alert('❌ Please select at least one trading coin.');
                return;
            }

            if (maxPositions < 1 || maxPositions > 20) {
                alert('❌ Maximum positions must be between 1 and 20.');
                return;
            }

            // Add loading state
            saveButton.classList.add('saving');
            saveButton.style.opacity = '0.6';
            saveButton.style.cursor = 'not-allowed';

            // Send settings to API
            const response = await fetch('/api/trading/settings', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    tradingSymbols,
                    maxPositions
                }),
            });

            const data = await response.json();

            if (data.success) {
                console.log('Trading settings updated:', data);

                // Update settings badge
                this.updateSettingsBadge(tradingSymbols, maxPositions);

                // Show success notification
                const message = `⚙️ Trading settings updated successfully!\n` +
                              `• Enabled coins: ${tradingSymbols.join(', ')}\n` +
                              `• Max positions: ${maxPositions}\n` +
                              `Changes take effect on the next trading cycle.`;

                this.showSettingsNotification(message, 'success');
            } else {
                console.error('Failed to update trading settings:', data.error);
                alert(`❌ Failed to update trading settings: ${data.error}`);
            }

        } catch (error) {
            console.error('Failed to update trading settings:', error);
            alert(`❌ Failed to update trading settings: ${error.message}`);
        } finally {
            // Remove loading state
            saveButton.classList.remove('saving');
            saveButton.style.opacity = '1';
            saveButton.style.cursor = 'pointer';
        }
    }

    // Update settings badge
    updateSettingsBadge(tradingSymbols, maxPositions) {
        const badge = document.getElementById('settings-status-badge');
        if (badge) {
            const coinsCount = tradingSymbols ? tradingSymbols.length : 0;
            badge.textContent = `${coinsCount} COINS • ${maxPositions} POS`;

            // Change color based on configuration
            if (coinsCount === 0) {
                badge.style.background = 'var(--color-red)';
            } else if (coinsCount <= 2) {
                badge.style.background = 'var(--color-orange)';
            } else if (coinsCount <= 5) {
                badge.style.background = 'var(--color-green)';
            } else {
                badge.style.background = 'var(--color-blue)';
            }
        }
    }

    // Show settings notification toast
    showSettingsNotification(message, type = 'info') {
        // Remove existing notification if any
        const existing = document.getElementById('settings-notification');
        if (existing) existing.remove();

        // Create notification element
        const notification = document.createElement('div');
        notification.id = 'settings-notification';
        notification.style.cssText = `
            position: fixed;
            top: 80px;
            right: 20px;
            padding: 16px 24px;
            background: ${type === 'success' ? '#10B981' : type === 'warning' ? '#F97316' : '#3B82F6'};
            color: white;
            border: 3px solid #000;
            font-family: 'Inter', sans-serif;
            font-weight: 700;
            font-size: 14px;
            z-index: 10000;
            box-shadow: 4px 4px 0 rgba(0, 0, 0, 0.2);
            animation: slideIn 0.3s ease-out;
            white-space: pre-line;
            max-width: 400px;
        `;
        notification.textContent = message;

        document.body.appendChild(notification);

        // Auto-remove after 6 seconds (longer for detailed settings message)
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease-out';
            setTimeout(() => notification.remove(), 300);
        }, 6000);
    }

    // Initialize AI learning system
    initLearningSystem() {
        const toggleButton = document.getElementById('toggle-learning-button');
        const lessonCountSelect = document.getElementById('lesson-count');
        const minSuccessRateSelect = document.getElementById('min-success-rate');
        const lessonAgeSelect = document.getElementById('lesson-age');

        if (!toggleButton) {
            console.error('Learning system elements not found');
            return;
        }

        // Initialize pagination state for reflections
        this.currentReflectionFilter = 'all';
        this.currentReflectionPage = 0;
        this.reflectionsPerPage = 5;

        // Initialize pagination state for trades
        this.currentTradePage = 0;
        this.tradesPerPage = 5;

        // Load initial status
        this.loadLearningStatus();

        // Add toggle button handler
        toggleButton.addEventListener('click', async () => {
            await this.toggleLearning();
        });

        // Add config change handlers
        [lessonCountSelect, minSuccessRateSelect, lessonAgeSelect].forEach(select => {
            if (select) {
                select.addEventListener('change', async () => {
                    await this.updateLearningConfig();
                });
            }
        });

        // Add filter button handlers
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                // Update active state
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                // Apply filter and reset to page 1
                this.currentReflectionFilter = e.target.dataset.filter;
                this.currentReflectionPage = 0;
                this.loadReflections();
            });
        });

        // Add pagination handlers
        const prevBtn = document.getElementById('prev-page');
        const nextBtn = document.getElementById('next-page');
        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                if (this.currentReflectionPage > 0) {
                    this.currentReflectionPage--;
                    this.loadReflections();
                }
            });
        }
        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                this.currentReflectionPage++;
                this.loadReflections();
            });
        }

        // Auto-refresh every 30 seconds
        setInterval(() => {
            this.loadLearningStatus();
            this.loadReflections();
        }, 30000);

        // Add trade history pagination handlers
        const tradesPrevBtn = document.getElementById('trades-prev-page');
        const tradesNextBtn = document.getElementById('trades-next-page');
        if (tradesPrevBtn) {
            tradesPrevBtn.addEventListener('click', () => {
                if (this.currentTradePage > 0) {
                    this.currentTradePage--;
                    this.loadTradesData();
                }
            });
        }
        if (tradesNextBtn) {
            tradesNextBtn.addEventListener('click', () => {
                this.currentTradePage++;
                this.loadTradesData();
            });
        }
    }

    // Load learning system status
    async loadLearningStatus() {
        try {
            const response = await fetch('/api/learning/status');
            const data = await response.json();

            // Update badge and button
            const badge = document.getElementById('learning-status-badge');
            const button = document.getElementById('toggle-learning-button');
            const buttonText = document.getElementById('learning-button-text');

            if (badge && button && buttonText) {
                if (data.learningEnabled) {
                    badge.textContent = 'ENABLED';
                    badge.classList.add('enabled');
                    buttonText.textContent = 'DISABLE LEARNING';
                    button.classList.add('enabled');
                } else {
                    badge.textContent = 'DISABLED';
                    badge.classList.remove('enabled');
                    buttonText.textContent = 'ENABLE LEARNING';
                    button.classList.remove('enabled');
                }
            }

            // Update statistics
            document.getElementById('total-reflections').textContent = data.totalReflections || 0;
            document.getElementById('active-lessons').textContent = data.activeLessons || 0;
            document.getElementById('pending-reviews').textContent = data.pendingReviews || 0;

            const avgEffectivenessEl = document.getElementById('avg-effectiveness');
            if (avgEffectivenessEl) {
                const avgEff = data.avgEffectiveness || 0;
                avgEffectivenessEl.textContent = avgEff.toFixed(1) + '%';
                avgEffectivenessEl.className = 'stat-value ' + (avgEff >= 70 ? 'positive' : avgEff >= 50 ? '' : 'negative');
            }

            // Load lessons and reflections
            await this.loadLessons();
            await this.loadReflections();

        } catch (error) {
            console.error('Failed to load learning status:', error);
        }
    }

    // Toggle learning system
    async toggleLearning() {
        const button = document.getElementById('toggle-learning-button');
        if (!button) return;

        const isEnabled = button.classList.contains('enabled');
        const newState = !isEnabled;

        try {
            const response = await fetch('/api/learning/toggle', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ enabled: newState }),
            });

            const data = await response.json();

            if (data.success) {
                console.log(data.message);

                // Show user notification
                const message = data.enabled
                    ? '🧠 AI Learning ENABLED - System will learn from predictions'
                    : '🔕 AI Learning DISABLED - System will not record predictions';

                this.showNotification(message, data.enabled ? 'success' : 'warning');

                // Reload status
                await this.loadLearningStatus();
            } else {
                console.error('Failed to toggle learning:', data.error);
                alert(`Failed to toggle learning: ${data.error}`);
            }
        } catch (error) {
            console.error('Failed to toggle learning:', error);
            alert(`Failed to toggle learning: ${error.message}`);
        }
    }

    // Update learning configuration
    async updateLearningConfig() {
        const lessonCount = parseInt(document.getElementById('lesson-count').value);
        const minSuccessRate = parseInt(document.getElementById('min-success-rate').value);
        const lessonAgeDays = parseInt(document.getElementById('lesson-age').value);

        try {
            const response = await fetch('/api/learning/config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    lessonCount,
                    minSuccessRate,
                    lessonAgeDays,
                }),
            });

            const data = await response.json();

            if (data.success) {
                console.log('Learning config updated:', data.config);
                this.showNotification('⚙️ Learning configuration updated', 'success');

                // Reload lessons with new config
                await this.loadLessons();
            } else {
                console.error('Failed to update config:', data.error);
                alert(`Failed to update config: ${data.error}`);
            }
        } catch (error) {
            console.error('Failed to update config:', error);
            alert(`Failed to update config: ${error.message}`);
        }
    }

    // Load top lessons
    async loadLessons() {
        try {
            const response = await fetch('/api/learning/lessons?limit=5');
            const data = await response.json();

            const lessonsList = document.getElementById('lessons-list');
            if (!lessonsList) return;

            if (!data.lessons || data.lessons.length === 0) {
                lessonsList.innerHTML = '<div class="lessons-empty">No lessons yet. System needs more trading data to learn patterns.</div>';
                return;
            }

            lessonsList.innerHTML = data.lessons.map((lesson, idx) => {
                const categoryColors = {
                    'risk_management': '#F97316',
                    'entry_timing': '#3B82F6',
                    'exit_strategy': '#10B981',
                    'market_conditions': '#A855F7',
                    'position_sizing': '#EAB308',
                };

                const categoryColor = categoryColors[lesson.category] || '#6B7280';
                const successRate = lesson.successRate.toFixed(0);
                const effectivenessRate = lesson.effectivenessRate
                    ? lesson.effectivenessRate.toFixed(0)
                    : 'N/A';

                const confidenceEmoji = lesson.confidenceLevel === 'high' ? '🔥' :
                                       lesson.confidenceLevel === 'medium' ? '⭐' : '💡';

                return `
                    <div class="lesson-card" style="border-left-color: ${categoryColor}">
                        <div class="lesson-header">
                            <span class="lesson-category" style="background: ${categoryColor}">${lesson.category.replace('_', ' ').toUpperCase()}</span>
                            <span class="lesson-confidence">${confidenceEmoji} ${lesson.confidenceLevel}</span>
                        </div>
                        <div class="lesson-text">${lesson.text}</div>
                        <div class="lesson-footer">
                            <span class="lesson-stat">✅ Success: ${successRate}%</span>
                            <span class="lesson-stat">📊 Effectiveness: ${effectivenessRate}%</span>
                            <span class="lesson-stat">🔢 Applied: ${lesson.timesApplied || 0}x</span>
                        </div>
                    </div>
                `;
            }).join('');

        } catch (error) {
            console.error('Failed to load lessons:', error);
        }
    }

    // Load reflections (predictions with outcomes)
    async loadReflections() {
        try {
            const offset = this.currentReflectionPage * this.reflectionsPerPage;
            const response = await fetch(`/api/learning/reflections?filter=${this.currentReflectionFilter}&limit=${this.reflectionsPerPage}&offset=${offset}`);
            const data = await response.json();

            const reflectionsList = document.getElementById('reflections-list');
            const paginationInfo = document.getElementById('pagination-info');
            const prevBtn = document.getElementById('prev-page');
            const nextBtn = document.getElementById('next-page');

            if (!reflectionsList) return;

            if (!data.reflections || data.reflections.length === 0) {
                reflectionsList.innerHTML = '<div class="reflections-empty">No reflections yet. Enable learning and start trading.</div>';
                // Hide pagination
                if (prevBtn) prevBtn.style.display = 'none';
                if (nextBtn) nextBtn.style.display = 'none';
                if (paginationInfo) paginationInfo.textContent = '';
                return;
            }

            // Show pagination controls
            if (prevBtn) prevBtn.style.display = 'inline-block';
            if (nextBtn) nextBtn.style.display = 'inline-block';

            // Update pagination info
            const currentPage = this.currentReflectionPage + 1;
            const totalPages = Math.ceil(data.pagination.total / this.reflectionsPerPage);
            const startItem = offset + 1;
            const endItem = Math.min(offset + data.reflections.length, data.pagination.total);

            if (paginationInfo) {
                paginationInfo.textContent = `${startItem}-${endItem} of ${data.pagination.total}`;
            }

            // Update button states
            if (prevBtn) {
                prevBtn.disabled = this.currentReflectionPage === 0;
            }
            if (nextBtn) {
                nextBtn.disabled = !data.pagination.hasMore;
            }

            // Render reflections
            reflectionsList.innerHTML = data.reflections.map(refl => {
                const timestamp = new Date(refl.timestamp).toLocaleString('en-US', {
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                });

                const hasFeedback = refl.feedbackScore !== null;
                const feedbackClass = hasFeedback
                    ? (refl.feedbackScore >= 8 ? 'accurate' : refl.feedbackScore <= 4 ? 'inaccurate' : 'neutral')
                    : 'pending';

                const decisionIcon = refl.decisionType.includes('long') ? '📈' :
                                    refl.decisionType.includes('short') ? '📉' : '⏸️';

                const feedbackText = hasFeedback
                    ? `Score: ${refl.feedbackScore}/10 | PnL: ${refl.pnlResult >= 0 ? '+' : ''}${refl.pnlResult?.toFixed(2) || 'N/A'}`
                    : 'Pending feedback...';

                return `
                    <div class="reflection-card ${feedbackClass}">
                        <div class="reflection-header">
                            <span class="reflection-symbol">${decisionIcon} ${refl.symbol}</span>
                            <span class="reflection-time">${timestamp}</span>
                            <span class="reflection-confidence">Confidence: ${refl.confidenceScore}/10</span>
                        </div>
                        <div class="reflection-vision">"${refl.vision}"</div>
                        <div class="reflection-footer">
                            <span class="reflection-decision">${refl.decisionType.toUpperCase()}</span>
                            <span class="reflection-feedback ${feedbackClass}">${feedbackText}</span>
                        </div>
                    </div>
                `;
            }).join('');

        } catch (error) {
            console.error('Failed to load reflections:', error);
        }
    }

    // Show login form
    showLoginForm() {
        // Prevent duplicate login forms
        if (document.getElementById('login-overlay')) {
            return;
        }

        console.log('Showing login form');

        const loginHTML = `
            <div id="login-overlay">
                <div class="login-box">
                    <h2>🔐 Authentication Required</h2>
                    <p class="login-subtitle">Please log in to access the trading dashboard</p>
                    <form id="login-form">
                        <div class="form-group">
                            <label for="username">Username:</label>
                            <input type="text" id="username" name="username" required autocomplete="username" placeholder="admin">
                        </div>
                        <div class="form-group">
                            <label for="password">Password:</label>
                            <input type="password" id="password" name="password" required autocomplete="current-password" placeholder="Enter password">
                        </div>
                        <button type="submit">Login</button>
                        <div id="login-error"></div>
                        <div class="login-hint">
                            <small>💡 Default credentials are in your .env file<br>
                            (ADMIN_USERNAME / ADMIN_PASSWORD)</small>
                        </div>
                    </form>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', loginHTML);

        const form = document.getElementById('login-form');
        if (form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                await this.handleLogin();
            });
        }
    }

    // Handle login
    async handleLogin() {
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        const errorEl = document.getElementById('login-error');

        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (response.ok && data.token) {
                this.token = data.token;
                localStorage.setItem('jwt_token', data.token);
                document.getElementById('login-overlay').remove();
                await this.init();
            } else {
                errorEl.textContent = data.error || 'Login failed';
                errorEl.style.display = 'block';
            }
        } catch (error) {
            errorEl.textContent = 'Login failed. Please try again.';
            errorEl.style.display = 'block';
        }
    }

    // Fetch with authentication
    async authenticatedFetch(url, options = {}) {
        const headers = {
            ...options.headers,
            'Authorization': `Bearer ${this.token}`
        };

        const response = await fetch(url, { ...options, headers });

        // Handle 401 Unauthorized
        if (response.status === 401) {
            localStorage.removeItem('jwt_token');
            this.token = null;
            this.showLoginForm();
            throw new Error('Unauthorized');
        }

        return response;
    }

    // Load initial data
    async loadInitialData() {
        try {
            // Load critical data first (account, positions, prices)
            await Promise.all([
                this.loadAccountData(),
                this.loadPositionsData(),
                this.loadTickerPrices()
            ]);

            // Load secondary data after (trades and logs - less critical)
            // These don't block the initial render
            Promise.all([
                this.loadTradesData(),
                this.loadLogsData()
            ]).catch(err => console.error('Failed to load secondary data:', err));
        } catch (error) {
            console.error('Failed to load initial data:', error);
        }
    }

    // Load GitHub star count
    async loadGitHubStars() {
        try {
            const response = await fetch('https://api.github.com/repos/195440/open-nof1.ai');
            const data = await response.json();
            const starsCount = document.getElementById('stars-count');
            if (starsCount && data.stargazers_count !== undefined) {
                // Format star count (display as k if over 1000)
                const count = data.stargazers_count;
                starsCount.textContent = count >= 1000 ? `${(count / 1000).toFixed(1)}k` : count;
            }
        } catch (error) {
            console.error('Failed to load GitHub star count:', error);
            const starsCount = document.getElementById('stars-count');
            if (starsCount) {
                starsCount.textContent = '-';
            }
        }
    }

    // Load account data
    async loadAccountData() {
        try {
            const response = await this.authenticatedFetch('/api/account');
            const data = await response.json();

            if (data.error) {
                console.error('API error:', data.error);
                return;
            }

            this.accountData = data;

            // Use the same algorithm as app.js to calculate total assets
            // API returned totalBalance does not include unrealized PnL
            // Displayed total assets need to add unrealized PnL to reflect position PnL in real time
            const totalBalanceWithPnl = data.totalBalance + data.unrealisedPnl;

            // Calculate profit/loss for color coding
            const totalPnl = totalBalanceWithPnl - data.initialBalance;
            const isPositive = totalPnl >= 0;

            // Update total assets
        const accountValueEl = document.getElementById('account-value');
            if (accountValueEl) {
                accountValueEl.textContent = totalBalanceWithPnl.toFixed(2);
                // Apply color class based on profit/loss
                accountValueEl.className = 'value-amount ' + (isPositive ? 'positive' : 'negative');
            }

            // Update available balance
            const availableBalanceEl = document.getElementById('available-balance');
            if (availableBalanceEl) {
                availableBalanceEl.textContent = data.availableBalance.toFixed(2);
            }

            // Update unrealized PnL (with sign and color)
            const unrealisedPnlEl = document.getElementById('unrealised-pnl');
            if (unrealisedPnlEl) {
                const pnlValue = (data.unrealisedPnl >= 0 ? '+' : '') + data.unrealisedPnl.toFixed(2);
                unrealisedPnlEl.textContent = pnlValue;
                unrealisedPnlEl.className = 'detail-value ' + (data.unrealisedPnl >= 0 ? 'positive' : 'negative');
            }

            // Update profit (total assets - initial capital)
        const valueChangeEl = document.getElementById('value-change');
        const valuePercentEl = document.getElementById('value-percent');

            if (valueChangeEl && valuePercentEl) {
                // Return rate = (total assets (including unrealized PnL) - initial capital) / initial capital * 100
                const returnPercent = (totalPnl / data.initialBalance) * 100;

                valueChangeEl.textContent = `${isPositive ? '+' : ''}$${Math.abs(totalPnl).toFixed(2)}`;
                valuePercentEl.textContent = `(${isPositive ? '+' : ''}${returnPercent.toFixed(2)}%)`;

                // Update colors
                valueChangeEl.className = 'change-amount ' + (isPositive ? 'positive' : 'negative');
                valuePercentEl.className = 'change-percent ' + (isPositive ? 'positive' : 'negative');
            }

        } catch (error) {
            console.error('Failed to load account data:', error);
        }
    }

    // Load positions data
    async loadPositionsData() {
        try {
            const response = await this.authenticatedFetch('/api/positions');
            const data = await response.json();

            if (data.error) {
                console.error('API error:', data.error);
                return;
            }

            const positionsBody = document.getElementById('positions-body');
            const positionsCardsContainer = document.getElementById('positions-cards-container');

            if (!data.positions || data.positions.length === 0) {
                // Update table
                if (positionsBody) {
                    positionsBody.innerHTML = '<tr><td colspan="12" class="empty-state">No positions</td></tr>';
                }
                // Update small cards
                if (positionsCardsContainer) {
                    positionsCardsContainer.innerHTML = '<div class="positions-cards-empty">No positions</div>';
                }
                return;
            }

            // Update cryptocurrency prices
            data.positions.forEach(pos => {
                this.cryptoPrices.set(pos.symbol, pos.currentPrice);
            });
            this.updateTickerPrices();

            // Update positions table
            if (positionsBody) {
                positionsBody.innerHTML = data.positions.map(pos => {
                    const profitPercent = ((pos.unrealizedPnl / pos.openValue) * 100).toFixed(2);
                    const sideText = pos.side === 'long' ? 'Long' : 'Short';
                    const sideClass = pos.side === 'long' ? 'positive' : 'negative';
                    const leverage = pos.leverage || '-';

                    // Format stop-loss display for table (supports multiple SLs)
                    let stopLossDisplay = '-';
                    if (pos.slOrders && pos.slOrders.length > 0) {
                        const activeSLs = pos.slOrders.filter(sl => !sl.triggered);
                        if (activeSLs.length > 0) {
                            if (activeSLs.length === 1) {
                                const sl = activeSLs[0];
                                const slDiff = ((sl.price - pos.currentPrice) / pos.currentPrice * 100).toFixed(1);
                                const slPrice = sl.price < 1 ? sl.price.toFixed(5) : sl.price.toFixed(2);
                                stopLossDisplay = `$${slPrice} (${slDiff}%, ${sl.percentage}%)`;
                            } else {
                                // Multiple SLs: show compact format
                                const slSummary = activeSLs.map(sl => {
                                    const slPrice = sl.price < 1 ? sl.price.toFixed(5) : sl.price.toFixed(2);
                                    return `${sl.percentage}%@$${slPrice}`;
                                }).join(', ');
                                stopLossDisplay = `${activeSLs.length} SLs: ${slSummary}`;
                            }
                        }
                    }
                    // Fallback: display old single SL format (backward compatibility)
                    else if (pos.stopLoss) {
                        const stopLossDiff = ((pos.stopLoss - pos.currentPrice) / pos.currentPrice * 100).toFixed(1);
                        const stopLossPrice = pos.stopLoss < 1 ? pos.stopLoss.toFixed(5) : pos.stopLoss.toFixed(2);
                        stopLossDisplay = `$${stopLossPrice} (${stopLossDiff}%)`;
                    }

                    // Format take-profit display for table (supports multiple TPs)
                    let takeProfitDisplay = '-';
                    if (pos.tpOrders && pos.tpOrders.length > 0) {
                        const activeTPs = pos.tpOrders.filter(tp => !tp.triggered);
                        if (activeTPs.length > 0) {
                            if (activeTPs.length === 1) {
                                const tp = activeTPs[0];
                                const tpDiff = ((tp.price - pos.currentPrice) / pos.currentPrice * 100).toFixed(1);
                                const tpPrice = tp.price < 1 ? tp.price.toFixed(5) : tp.price.toFixed(2);
                                takeProfitDisplay = `$${tpPrice} (${tpDiff}%, ${tp.percentage}%)`;
                            } else {
                                // Multiple TPs: show compact format
                                const tpSummary = activeTPs.map(tp => {
                                    const tpPrice = tp.price < 1 ? tp.price.toFixed(5) : tp.price.toFixed(2);
                                    return `${tp.percentage}%@$${tpPrice}`;
                                }).join(', ');
                                takeProfitDisplay = `${activeTPs.length} TPs: ${tpSummary}`;
                            }
                        }
                    }

                    // 🔥 Entry Order ID display
                    const entryOrderHtml = pos.entryOrderId
                        ? `<span class="order-id" onclick="navigator.clipboard.writeText('${pos.entryOrderId}')" title="Click to copy">${pos.entryOrderId.substring(0, 10)}...</span>`
                        : '<span class="na">-</span>';

                    // 🔥 SL Order ID display (support multi-SL)
                    let slOrderHtml = '<span class="na">-</span>';
                    if (pos.slOrders && pos.slOrders.length > 0) {
                        const activeSLs = pos.slOrders.filter(sl => !sl.triggered);
                        if (activeSLs.length > 0) {
                            if (activeSLs.length === 1) {
                                const orderId = activeSLs[0].orderId;
                                slOrderHtml = `<span class="order-id" onclick="navigator.clipboard.writeText('${orderId}')" title="Click to copy">${orderId.substring(0, 10)}...</span>`;
                            } else {
                                // Multiple SLs: show compact list
                                const orderIds = activeSLs.map(sl => sl.orderId.substring(0, 8)).join(', ');
                                const fullIds = activeSLs.map(sl => sl.orderId).join(', ');
                                slOrderHtml = `<span class="order-id" onclick="navigator.clipboard.writeText('${fullIds}')" title="Click to copy (${activeSLs.length} IDs)">${activeSLs.length} SLs: ${orderIds}...</span>`;
                            }
                        }
                    }
                    // Fallback to old single SL format
                    else if (pos.slOrderId) {
                        slOrderHtml = `<span class="order-id" onclick="navigator.clipboard.writeText('${pos.slOrderId}')" title="Click to copy">${pos.slOrderId.substring(0, 10)}...</span>`;
                    }

                    return `
                        <tr>
                            <td>${pos.symbol}</td>
                            <td class="${sideClass}">${sideText}</td>
                            <td>${leverage}x</td>
                            <td>$${pos.entryPrice.toFixed(4)}</td>
                            <td>$${pos.currentPrice.toFixed(4)}</td>
                            <td class="stoploss-cell">${stopLossDisplay}</td>
                            <td class="takeprofit-cell">${takeProfitDisplay}</td>
                            <td>$${pos.openValue.toFixed(2)}</td>
                            <td class="${pos.unrealizedPnl >= 0 ? 'positive' : 'negative'}">
                                ${pos.unrealizedPnl >= 0 ? '+' : ''}$${pos.unrealizedPnl.toFixed(2)}
                            </td>
                            <td class="${pos.unrealizedPnl >= 0 ? 'positive' : 'negative'}">
                                ${pos.unrealizedPnl >= 0 ? '+' : ''}${profitPercent}%
                            </td>
                            <td>${entryOrderHtml}</td>
                            <td>${slOrderHtml}</td>
                        </tr>
                    `;
                }).join('');
            }

            // Update position small cards
            if (positionsCardsContainer) {
                positionsCardsContainer.innerHTML = data.positions.map(pos => {
                    const profitPercent = ((pos.unrealizedPnl / pos.openValue) * 100).toFixed(2);
                    const sideClass = pos.side;
                    const sideText = pos.side === 'long' ? 'L' : 'S';
                    const pnlClass = pos.unrealizedPnl >= 0 ? 'positive' : 'negative';
                    const leverage = pos.leverage || '-';

                    // Format stop-loss display (supports multiple SLs)
                    let stopLossText = '';
                    if (pos.slOrders && pos.slOrders.length > 0) {
                        const activeSLs = pos.slOrders.filter(sl => !sl.triggered);
                        if (activeSLs.length > 0) {
                            stopLossText = activeSLs.map((sl, idx) => {
                                const slDiff = ((sl.price - pos.currentPrice) / pos.currentPrice * 100).toFixed(1);
                                const slPrice = sl.price < 1 ? sl.price.toFixed(5) : sl.price.toFixed(2);
                                return `<div class="position-card-stoploss">SL${idx + 1}: ${sl.percentage}% @ $${slPrice} (${slDiff}%)</div>`;
                            }).join('');
                        }
                    }
                    // Fallback: display old single SL format (backward compatibility)
                    else if (pos.stopLoss) {
                        const stopLossDiff = ((pos.stopLoss - pos.currentPrice) / pos.currentPrice * 100).toFixed(1);
                        stopLossText = `<div class="position-card-stoploss">SL: $${pos.stopLoss.toFixed(pos.stopLoss < 1 ? 5 : 2)} (${stopLossDiff}%)</div>`;
                    }

                    // Format take-profit display (supports multiple TPs)
                    let takeProfitText = '';
                    if (pos.tpOrders && pos.tpOrders.length > 0) {
                        const activeTPs = pos.tpOrders.filter(tp => !tp.triggered);
                        if (activeTPs.length > 0) {
                            takeProfitText = activeTPs.map((tp, idx) => {
                                const tpDiff = ((tp.price - pos.currentPrice) / pos.currentPrice * 100).toFixed(1);
                                const tpPrice = tp.price < 1 ? tp.price.toFixed(5) : tp.price.toFixed(2);
                                return `<div class="position-card-takeprofit">TP${idx + 1}: ${tp.percentage}% @ $${tpPrice} (${tpDiff}%)</div>`;
                            }).join('');
                        }
                    }

                    // 🔥 Order IDs for position cards
                    let orderIdsText = '';
                    if (pos.entryOrderId || pos.slOrderId || (pos.slOrders && pos.slOrders.length > 0)) {
                        const entryId = pos.entryOrderId ? `Entry: ${pos.entryOrderId.substring(0, 8)}...` : '';

                        // Show SL order IDs (support multi-SL)
                        let slId = '';
                        if (pos.slOrders && pos.slOrders.length > 0) {
                            const activeSLs = pos.slOrders.filter(sl => !sl.triggered);
                            if (activeSLs.length > 0) {
                                if (activeSLs.length === 1) {
                                    slId = `SL: ${activeSLs[0].orderId.substring(0, 8)}...`;
                                } else {
                                    slId = `SLs: ${activeSLs.length} orders`;
                                }
                            }
                        }
                        // Fallback to old single SL format
                        else if (pos.slOrderId) {
                            slId = `SL: ${pos.slOrderId.substring(0, 8)}...`;
                        }

                        const idsArray = [entryId, slId].filter(id => id);
                        orderIdsText = `<div class="position-card-ids" title="Click to see full IDs in table">${idsArray.join(' | ')}</div>`;
                    }

                    return `
                        <div class="position-card ${sideClass} ${pnlClass}">
                            <span class="position-card-symbol">${pos.symbol} ${leverage}x</span>
                            <span class="position-card-pnl ${pnlClass}">
                                ${sideText} ${pos.unrealizedPnl >= 0 ? '+' : ''}$${pos.unrealizedPnl.toFixed(2)} (${pos.unrealizedPnl >= 0 ? '+' : ''}${profitPercent}%)
                            </span>
                            ${stopLossText}
                            ${takeProfitText}
                            ${orderIdsText}
                            <div class="position-card-actions">
                                <button class="take-profit-btn-card" onclick="window.monitor.showTakeProfitMenu('${pos.symbol}')" title="Take profit partially">💰</button>
                                <button class="close-position-btn-card" onclick="window.monitor.closePosition('${pos.symbol}')" title="Close position">✕</button>
                            </div>
                        </div>
                    `;
                }).join('');
            }

        } catch (error) {
            console.error('Failed to load positions data:', error);
        }
    }

    // Close position manually
    async closePosition(symbol) {
        if (!confirm(`Are you sure you want to close ${symbol} position?`)) {
            return;
        }

        try {
            const response = await fetch(`/api/positions/${symbol}/close`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ percentage: 100 })
            });

            const result = await response.json();

            if (result.success) {
                alert(`✅ ${result.message}`);
                // Reload positions and account data
                await this.loadPositionsData();
                await this.loadAccountData();
            } else {
                alert(`❌ Close failed: ${result.error}`);
            }
        } catch (error) {
            console.error('Close position request failed:', error);
            alert(`❌ Close request failed: ${error.message}`);
        }
    }

    // Show take profit menu with percentage options
    showTakeProfitMenu(symbol) {
        const percentage = prompt(
            `💰 Take Profit on ${symbol}\n\n` +
            `Enter percentage to close (30, 50, or 80):\n` +
            `- 30% = Close 30% of position\n` +
            `- 50% = Close 50% of position (default)\n` +
            `- 80% = Close 80% of position`,
            '50'
        );

        if (percentage === null) {
            return; // User cancelled
        }

        const percentNum = parseInt(percentage);
        if (isNaN(percentNum) || percentNum < 1 || percentNum > 100) {
            alert('❌ Invalid percentage. Please enter a number between 1-100.');
            return;
        }

        // Common options: validate
        if (![30, 50, 80].includes(percentNum)) {
            if (!confirm(`⚠️ You entered ${percentNum}%. This is not a standard option (30/50/80). Continue anyway?`)) {
                return;
            }
        }

        this.takeProfitPartial(symbol, percentNum);
    }

    // Take profit partially
    async takeProfitPartial(symbol, percentage) {
        if (!confirm(`💰 Take profit: Close ${percentage}% of ${symbol} position?`)) {
            return;
        }

        try {
            const response = await fetch(`/api/positions/${symbol}/close`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ percentage })
            });

            const result = await response.json();

            if (result.success) {
                alert(`✅ ${result.message}`);
                // Reload positions and account data
                await this.loadPositionsData();
                await this.loadAccountData();
            } else {
                alert(`❌ Take profit failed: ${result.error}`);
            }
        } catch (error) {
            console.error('Take profit request failed:', error);
            alert(`❌ Take profit request failed: ${error.message}`);
        }
    }

    // Load trades data - using the same layout as index.html
    async loadTradesData() {
        try {
            // Only fetch from API if we don't have cached trades or it's been >30s
            if (!this.cachedTrades || Date.now() - this.lastTradesLoad > 30000) {
                const response = await this.authenticatedFetch('/api/trades?limit=100');
                const data = await response.json();

                if (data.error) {
                    console.error('API error:', data.error);
                    return;
                }

                this.cachedTrades = data.trades || [];
                this.lastTradesLoad = Date.now();
            }

            const tradesBody = document.getElementById('trades-body');
            const countEl = document.getElementById('tradesCount');
            const paginationInfo = document.getElementById('trades-pagination-info');
            const prevBtn = document.getElementById('trades-prev-page');
            const nextBtn = document.getElementById('trades-next-page');

            if (!this.cachedTrades || this.cachedTrades.length === 0) {
                if (tradesBody) {
                    tradesBody.innerHTML = '<tr><td colspan="12" class="empty-state">No trade history</td></tr>';
                }
                if (countEl) {
                    countEl.textContent = '';
                }
                // Hide pagination
                if (prevBtn) prevBtn.style.display = 'none';
                if (nextBtn) nextBtn.style.display = 'none';
                if (paginationInfo) paginationInfo.textContent = '';
                return;
            }

            // Client-side pagination
            const totalTrades = this.cachedTrades.length;
            const offset = this.currentTradePage * this.tradesPerPage;
            const paginatedTrades = this.cachedTrades.slice(offset, offset + this.tradesPerPage);

            // Show pagination controls
            if (prevBtn) prevBtn.style.display = 'inline-block';
            if (nextBtn) nextBtn.style.display = 'inline-block';

            // Update pagination info
            const startItem = offset + 1;
            const endItem = Math.min(offset + paginatedTrades.length, totalTrades);
            if (paginationInfo) {
                paginationInfo.textContent = `${startItem}-${endItem} of ${totalTrades}`;
            }

            // Update button states
            if (prevBtn) {
                prevBtn.disabled = this.currentTradePage === 0;
            }
            if (nextBtn) {
                nextBtn.disabled = offset + this.tradesPerPage >= totalTrades;
            }

            if (countEl) {
                countEl.textContent = `(${totalTrades} total)`;
            }

            if (tradesBody) {
                tradesBody.innerHTML = paginatedTrades.map(trade => {
                    const date = new Date(trade.timestamp);
                    const timeStr = date.toLocaleString('en-US', {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: false
                    });

                    // Type display
                    const typeText = trade.type === 'open' ? 'Open' : 'Close';
                    const typeClass = trade.type === 'open' ? 'buy' : 'sell';

                    // Direction display
                    const sideText = trade.side === 'long' ? 'Long' : 'Short';
                    const sideClass = trade.side === 'long' ? 'long' : 'short';

                    // PnL display (only show on close)
                    const pnlHtml = trade.type === 'close' && trade.pnl !== null && trade.pnl !== undefined
                        ? `<span class="${trade.pnl >= 0 ? 'profit' : 'loss'}">${trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)}</span>`
                        : '<span class="na">-</span>';

                    // Close reason display (only for closed positions)
                    let closeReasonHtml = '<span class="na">-</span>';
                    if (trade.type === 'close' && trade.closeReason) {
                        const reasonMap = {
                            'manual': '📝 Manual',
                            'stop_loss': '🛑 Stop Loss',
                            'take_profit': '🎯 Take Profit',
                            'take_profit_partial': '🎯 TP Partial',
                            'time_limit': '⏰ Time Limit',
                            'drawdown': '📉 Drawdown'
                        };
                        closeReasonHtml = `<span class="close-reason">${reasonMap[trade.closeReason] || trade.closeReason}</span>`;
                    }

                    // 🔥 Order ID display (clickable for copying)
                    const orderIdHtml = trade.orderId
                        ? `<span class="order-id" onclick="navigator.clipboard.writeText('${trade.orderId}')" title="Click to copy">${trade.orderId.substring(0, 10)}...</span>`
                        : '<span class="na">-</span>';

                    // 🔥 Entry link for close trades
                    const entryLinkHtml = trade.type === 'close' && trade.entryOrderId
                        ? `<span class="entry-link" onclick="highlightTrade('${trade.entryOrderId}')" title="Jump to entry trade">🔗 ${trade.entryOrderId.substring(0, 10)}...</span>`
                        : '<span class="na">-</span>';

                    return `
                        <tr data-order-id="${trade.orderId}">
                            <td>${timeStr}</td>
                            <td><span class="symbol">${trade.symbol}</span></td>
                            <td><span class="type ${typeClass}">${typeText}</span></td>
                            <td><span class="side ${sideClass}">${sideText}</span></td>
                            <td>${trade.price.toFixed(2)}</td>
                            <td>${trade.quantity}</td>
                            <td>${trade.leverage}x</td>
                            <td>${trade.fee.toFixed(4)}</td>
                            <td>${pnlHtml}</td>
                            <td>${closeReasonHtml}</td>
                            <td>${orderIdHtml}</td>
                            <td>${entryLinkHtml}</td>
                        </tr>
                    `;
                }).join('');
            }

        } catch (error) {
            console.error('Failed to load trade history:', error);
        }
    }

    // Load AI decision logs - display the latest complete entry
    async loadLogsData() {
        try {
            const response = await this.authenticatedFetch('/api/logs?limit=1');
            const data = await response.json();

            if (data.error) {
                console.error('API error:', data.error);
                return;
            }

            const decisionContent = document.getElementById('decision-content');
            const decisionMeta = document.getElementById('decision-meta');

            if (data.logs && data.logs.length > 0) {
                const log = data.logs[0]; // Only take the latest one

                // Update decision metadata
                if (decisionMeta) {
                    const timestamp = new Date(log.timestamp).toLocaleString('zh-CN', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit'
                    });

                    decisionMeta.innerHTML = `
                        <span class="decision-time">${timestamp}</span>
                        <span class="decision-iteration">#${log.iteration}</span>
                    `;
                }

                // Update decision detailed content
                if (decisionContent) {
                    const decision = log.decision || log.actionsTaken || 'No decision content';
                    // Parse markdown to HTML using marked.js
                    const htmlContent = marked.parse(decision);
                    decisionContent.innerHTML = htmlContent;
                }
            } else {
                if (decisionContent) {
                    decisionContent.innerHTML = '<p class="no-data">No AI decision logs</p>';
                }
                if (decisionMeta) {
                    decisionMeta.innerHTML = '<span class="decision-time">No data</span>';
                }
            }

        } catch (error) {
            console.error('Failed to load logs:', error);
            const decisionContent = document.getElementById('decision-content');
            if (decisionContent) {
                decisionContent.innerHTML = `<p class="error">Failed to load: ${error.message}</p>`;
            }
        }
    }

    // Load top ticker prices (from API)
    async loadTickerPrices() {
        try {
            const response = await this.authenticatedFetch('/api/prices?symbols=BTC,ETH,SOL,BNB,DOGE,XRP');
            const data = await response.json();

            if (data.error) {
                console.error('Failed to get prices:', data.error);
                return;
            }

            // Update price cache
            Object.entries(data.prices).forEach(([symbol, price]) => {
                this.cryptoPrices.set(symbol, price);
            });

            // Update display
            this.updateTickerPrices();
        } catch (error) {
            console.error('Failed to load ticker prices:', error);
        }
    }

    // Update price ticker
    updateTickerPrices() {
        this.cryptoPrices.forEach((price, symbol) => {
                const priceElements = document.querySelectorAll(`[data-symbol="${symbol}"]`);
                priceElements.forEach(el => {
                const decimals = price < 1 ? 4 : 2;
                el.textContent = '$' + price.toFixed(decimals);
            });
        });
    }

    // Start data updates
    startDataUpdates() {
        // Update account and positions every 3 seconds (real-time data)
        setInterval(async () => {
            await Promise.all([
                this.loadAccountData(),
                this.loadPositionsData()
            ]);
        }, 3000);

        // Update prices every 10 seconds (real-time prices)
        setInterval(async () => {
            await this.loadTickerPrices();
        }, 10000);

        // Update trade history and logs every 30 seconds
        setInterval(async () => {
            await Promise.all([
                this.loadTradesData(),
                this.loadLogsData()
            ]);
        }, 30000);

        // Update equity chart every 30 seconds
        setInterval(async () => {
            try {
                await this.updateEquityChart();
            } catch (error) {
                console.error('[Equity Chart] Update failed:', error);
            }
        }, 30000);

        // Also do an immediate update after 5 seconds (for testing)
        setTimeout(async () => {
            try {
                console.log('[Equity Chart] Running initial update after 5 seconds');
                await this.updateEquityChart();
            } catch (error) {
                console.error('[Equity Chart] Initial update failed:', error);
            }
        }, 5000);
    }

    // Duplicate ticker content for seamless scrolling
    duplicateTicker() {
        const ticker = document.getElementById('ticker');
        if (ticker) {
            const tickerContent = ticker.innerHTML;
            ticker.innerHTML = tickerContent + tickerContent + tickerContent;
        }
    }

    // Initialize tabs (simplified version, only one tab)
    initTabs() {
        // Already only one tab, no switching functionality needed
    }

    // Initialize chat functionality (removed)
    initChat() {
        // Chat functionality has been removed
    }

    // Initialize equity chart
    async initEquityChart() {
        const ctx = document.getElementById('equityChart');
        if (!ctx) {
            console.error('Chart canvas element not found');
            return;
        }

        // Load historical data
        const historyData = await this.loadEquityHistory();

        console.log('Asset history data:', historyData);

        if (!historyData || historyData.length === 0) {
            console.log('No historical data, chart will display when data is available');
            // Show message
            const container = ctx.parentElement;
            if (container) {
                const message = document.createElement('div');
                message.className = 'no-data';
                message.style.cssText = 'position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: #00cc88; text-align: center;';
                message.innerHTML = 'No historical data<br><small style="color: #008866;">System will automatically record account assets every 10 minutes</small>';
                container.appendChild(message);
            }
            return;
        }

        // Create chart
        this.equityChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: historyData.map(d => {
                    const date = new Date(d.timestamp);
                    return date.toLocaleString('zh-CN', {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                }),
                datasets: [
                    {
                        label: 'Total Assets (USDT)',
                        data: historyData.map(d => parseFloat(d.totalValue.toFixed(2))),
                        borderColor: '#3B82F6',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        borderWidth: 3,
                        fill: true,
                        tension: 0.1,
                        pointRadius: 0,
                        pointHoverRadius: 6,
                        pointHoverBackgroundColor: '#3B82F6',
                        pointHoverBorderColor: '#000000',
                        pointHoverBorderWidth: 2
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        align: 'start',
                        labels: {
                            color: '#000000',
                            font: {
                                family: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                                size: 13,
                                weight: '600'
                            },
                            usePointStyle: true,
                            padding: 16,
                            boxWidth: 12,
                            boxHeight: 12
                        }
                    },
                    tooltip: {
                        backgroundColor: '#FFFFFF',
                        titleColor: '#000000',
                        bodyColor: '#000000',
                        borderColor: '#000000',
                        borderWidth: 2,
                        padding: 12,
                        displayColors: true,
                        titleFont: {
                            family: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                            size: 13,
                            weight: '600'
                        },
                        bodyFont: {
                            family: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
                            size: 12,
                            weight: '500'
                        },
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) {
                                    label += ': ';
                                }
                                if (context.parsed.y !== null) {
                                    label += '$' + context.parsed.y.toLocaleString('en-US', {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2
                                    });
                                }
                                return label;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        display: true,
                        grid: {
                            color: '#E5E5E5',
                            drawBorder: false,
                            lineWidth: 1
                        },
                        ticks: {
                            color: '#000000',
                            font: {
                                family: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                                size: 11,
                                weight: '500'
                            },
                            maxRotation: 45,
                            minRotation: 0,
                            maxTicksLimit: 10
                        }
                    },
                    y: {
                        display: true,
                        position: 'left',
                        grid: {
                            color: '#E5E5E5',
                            drawBorder: false,
                            lineWidth: 1
                        },
                        ticks: {
                            color: '#000000',
                            font: {
                                family: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
                                size: 11,
                                weight: '500'
                            },
                            callback: function(value) {
                                return '$' + value.toLocaleString('en-US', {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2
                                });
                            }
                        }
                    }
                }
            }
        });
    }

    // Load asset history data
    async loadEquityHistory() {
        try {
            // Get last 8 hours of data (with cache-busting timestamp)
            const cacheBuster = Date.now();
            const response = await this.authenticatedFetch(`/api/history?hours=8&_=${cacheBuster}`);
            const data = await response.json();

            if (data.error) {
                console.error('API error:', data.error);
                return [];
            }

            return data.history || [];
        } catch (error) {
            console.error('Failed to load asset history data:', error);
            return [];
        }
    }

    // Update equity chart
    async updateEquityChart() {
        try {
            console.log('[Equity Chart] Starting update...');

            const historyData = await this.loadEquityHistory();

            if (!historyData || historyData.length === 0) {
                console.log('[Equity Chart] No history data available');
                return;
            }

            console.log(`[Equity Chart] Loaded ${historyData.length} data points`);

            // Destroy existing chart to ensure clean render
            if (this.equityChart) {
                console.log('[Equity Chart] Destroying old chart instance');
                this.equityChart.destroy();
                this.equityChart = null;
            }

            // Completely recreate the canvas element to clear any cached state
            const oldCanvas = document.getElementById('equityChart');
            if (oldCanvas) {
                const container = oldCanvas.parentElement;
                if (!container) {
                    console.error('[Equity Chart] Canvas parent container not found');
                    return;
                }
                // Clear the entire container (removes canvas and any "no data" messages)
                container.innerHTML = '';
                // Create fresh canvas
                const newCanvas = document.createElement('canvas');
                newCanvas.id = 'equityChart';
                container.appendChild(newCanvas);
                console.log('[Equity Chart] Canvas element recreated');
            } else {
                console.warn('[Equity Chart] Old canvas not found, will create new one');
            }

            // Recreate chart with fresh data
            await this.initEquityChart();
            console.log('[Equity Chart] ✅ Chart update complete!');
        } catch (error) {
            console.error('[Equity Chart] ❌ Update error:', error);
            throw error;
        }
    }

    // Initialize timeframe selector (switching functionality disabled)
    initTimeframeSelector() {
        // Timeframe is fixed to 24 hours, switching no longer supported
    }
}

// 🔥 Global helper function for highlighting trades
function highlightTrade(orderId) {
    const row = document.querySelector(`tr[data-order-id="${orderId}"]`);
    if (row) {
        // Remove any existing highlights
        document.querySelectorAll('tr.highlighted').forEach(el => el.classList.remove('highlighted'));

        // Add highlight and scroll to row
        row.classList.add('highlighted');
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // Remove highlight after 3 seconds
        setTimeout(() => row.classList.remove('highlighted'), 3000);
    } else {
        console.warn('Entry trade not found:', orderId);
    }
}

// ==================== ALL LESSONS SECTION ====================

let lessonsData = [];
let filteredLessons = [];
let currentPage = 1;
let lessonsPerPage = 5;
let currentFilter = 'all';

function initLessonsSection() {
    loadLessons();
    setupLessonsEventListeners();
}

async function loadLessons() {
    try {
        showLoading('lessons-section');

        const response = await fetch('/api/learning/lessons?limit=1000');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        console.log('Lessons API response:', data); // Debug log

        lessonsData = data.lessons || [];
        filteredLessons = [...lessonsData];

        console.log('Loaded lessons:', lessonsData.length, 'items'); // Debug log

        updateLessonsStats();
        renderLessons();
        updateLessonsPagination();

    } catch (error) {
        console.error('Error loading lessons:', error);
        showError('lessons-section', 'Failed to load lessons: ' + error.message);
    }
}

function updateLessonsStats() {
    // Update statistics values in existing HTML elements
    const totalEl = document.getElementById('lessons-total-count');
    const activeEl = document.getElementById('lessons-active-count');
    const avgSuccessEl = document.getElementById('lessons-avg-success');
    const topCategoryEl = document.getElementById('lessons-top-category');

    const totalLessons = lessonsData.length;
    const activeLessons = lessonsData.filter(l => l.isActive === 1).length;
    const avgSuccessRate = totalLessons > 0 ?
        (lessonsData.reduce((sum, l) => sum + (l.successRate || 0), 0) / totalLessons).toFixed(1) : 0;

    // Find top category
    let topCategory = '-';
    if (totalLessons > 0) {
        const categoryCounts = {};
        lessonsData.forEach(lesson => {
            const category = lesson.category || 'unknown';
            categoryCounts[category] = (categoryCounts[category] || 0) + 1;
        });
        const sortedCategories = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]);
        if (sortedCategories.length > 0) {
            topCategory = sortedCategories[0][0].replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
        }
    }

    // Update DOM elements
    if (totalEl) totalEl.textContent = totalLessons;
    if (activeEl) activeEl.textContent = activeLessons;
    if (avgSuccessEl) avgSuccessEl.textContent = avgSuccessRate + '%';
    if (topCategoryEl) topCategoryEl.textContent = topCategory;

    // Update lessons count badge in header
    const countBadge = document.getElementById('lessons-count-badge');
    if (countBadge) {
        countBadge.textContent = `${totalLessons} Lessons`;
    }
}

function setupLessonsEventListeners() {
    // Category filter dropdown
    const categoryFilter = document.getElementById('lessons-category-filter');
    if (categoryFilter) {
        categoryFilter.addEventListener('change', function() {
            currentFilter = this.value;
            filterLessons();
        });
    }

    // Confidence filter dropdown
    const confidenceFilter = document.getElementById('lessons-confidence-filter');
    if (confidenceFilter) {
        confidenceFilter.addEventListener('change', function() {
            filterLessons();
        });
    }

    // Sort dropdown
    const sortSelect = document.getElementById('lessons-sort');
    if (sortSelect) {
        sortSelect.addEventListener('change', function() {
            sortLessons(this.value);
        });
    }

    // Pagination controls - match Recent Predictions pattern
    const prevButton = document.getElementById('lessons-prev-page');
    const nextButton = document.getElementById('lessons-next-page');

    if (prevButton) {
        prevButton.addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage--;
                renderLessons();
                updateLessonsPagination();
            }
        });
    }

    if (nextButton) {
        nextButton.addEventListener('click', () => {
            const maxPage = Math.ceil(filteredLessons.length / lessonsPerPage);
            if (currentPage < maxPage) {
                currentPage++;
                renderLessons();
                updateLessonsPagination();
            }
        });
    }
}

function filterLessons() {
    const categoryFilter = document.getElementById('lessons-category-filter')?.value || 'all';
    const confidenceFilter = document.getElementById('lessons-confidence-filter')?.value || 'all';
    const searchTerm = document.querySelector('.lessons-search input')?.value.toLowerCase() || '';

    filteredLessons = lessonsData.filter(lesson => {
        // Filter by category
        if (categoryFilter !== 'all' && lesson.category !== categoryFilter) {
            return false;
        }

        // Filter by confidence level
        if (confidenceFilter !== 'all' && lesson.confidenceLevel !== confidenceFilter) {
            return false;
        }

        // Filter by search term (if search input exists)
        if (searchTerm && !lesson.text.toLowerCase().includes(searchTerm)) {
            return false;
        }

        return true;
    });

    currentPage = 1;
    renderLessons();
    updateLessonsPagination();
}

function sortLessons(sortBy) {
    switch (sortBy) {
        case 'success_rate_desc':
            filteredLessons.sort((a, b) => (b.successRate || 0) - (a.successRate || 0));
            break;
        case 'created_at_desc':
            filteredLessons.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
            break;
        case 'created_at_asc':
            filteredLessons.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
            break;
        case 'effectiveness_desc':
            filteredLessons.sort((a, b) => (b.effectivenessRate || 0) - (a.effectivenessRate || 0));
            break;
        case 'times_applied_desc':
            filteredLessons.sort((a, b) => (b.timesApplied || 0) - (a.timesApplied || 0));
            break;
    }

    currentPage = 1;
    renderLessons();
    updateLessonsPagination();
}

function renderLessons() {
    const lessonsGrid = document.querySelector('.lessons-grid');
    if (!lessonsGrid) return;

    const startIndex = (currentPage - 1) * lessonsPerPage;
    const endIndex = startIndex + lessonsPerPage;
    const lessonsToShow = filteredLessons.slice(startIndex, endIndex);

    if (lessonsToShow.length === 0) {
        lessonsGrid.innerHTML = `
            <div class="no-lessons" style="grid-column: 1 / -1; text-align: center; padding: var(--space-xl); color: var(--color-gray-600);">
                <h3 style="margin-bottom: var(--space-md);">📚 No Lessons Yet</h3>
                <p>The AI learning system hasn't generated any lessons yet.</p>
                <p style="margin-top: var(--space-sm); font-size: 0.875rem;">
                    Lessons are created when the system analyzes trading patterns and learns from outcomes.
                </p>
                <p style="margin-top: var(--space-sm); font-size: 0.875rem;">
                    Start trading and enable AI learning to begin generating lessons.
                </p>
            </div>
        `;
        return;
    }

    lessonsGrid.innerHTML = lessonsToShow.map(lesson => {
        const categoryColors = {
            'risk_management': '#F97316',
            'entry_timing': '#3B82F6',
            'exit_strategy': '#10B981',
            'market_conditions': '#A855F7',
            'position_sizing': '#EAB308',
        };

        const categoryColor = categoryColors[lesson.category] || '#6B7280';
        const successRate = (lesson.successRate || 0).toFixed(0);
        const effectivenessRate = lesson.effectivenessRate
            ? lesson.effectivenessRate.toFixed(0)
            : 'N/A';

        const confidenceEmoji = lesson.confidenceLevel === 'high' ? '🔥' :
                               lesson.confidenceLevel === 'medium' ? '⭐' : '💡';

        return `
            <div class="lesson-card" data-lesson-id="${lesson.id}" style="border-left-color: ${categoryColor}">
                <div class="lesson-header">
                    <span class="lesson-category" style="background: ${categoryColor}">${lesson.category.replace('_', ' ').toUpperCase()}</span>
                    <span class="lesson-confidence">${confidenceEmoji} ${lesson.confidenceLevel}</span>
                </div>
                <div class="lesson-text">${lesson.text}</div>
                <div class="lesson-meta">
                    <span>✅ Success: ${successRate}%</span>
                    <span>📊 Effectiveness: ${effectivenessRate}%</span>
                    <span>🔢 Applied: ${lesson.timesApplied || 0}x</span>
                </div>
            </div>
        `;
    }).join('');
}

function updateLessonsPagination() {
    const totalPages = Math.ceil(filteredLessons.length / lessonsPerPage);
    const prevButton = document.getElementById('lessons-prev-page');
    const nextButton = document.getElementById('lessons-next-page');
    const pageInfo = document.getElementById('lessons-pagination-info');

    if (!prevButton || !nextButton || !pageInfo) return;

    // Update button states
    prevButton.disabled = currentPage === 1;
    nextButton.disabled = currentPage === totalPages || totalPages === 0;

    // Update page info - match Recent Predictions format
    if (totalPages === 0) {
        pageInfo.textContent = 'Page 1';
    } else {
        pageInfo.textContent = `Page ${currentPage}`;
    }
}

function formatCategory(category) {
    return category.split('_').map(word =>
        word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
}

function truncateText(text, maxLength) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function showLoading(sectionId) {
    const section = document.getElementById(sectionId);
    if (section) {
        const grid = section.querySelector('.lessons-grid');
        if (grid) {
            grid.innerHTML = '<div class="loading">Loading lessons...</div>';
        }
    }
}

function showError(sectionId, message) {
    const section = document.getElementById(sectionId);
    if (section) {
        const grid = section.querySelector('.lessons-grid');
        if (grid) {
            grid.innerHTML = `<div class="error">Error: ${message}</div>`;
        }
    }
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Initialize monitoring system
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM ready, initializing TradingMonitor');
    const monitor = new TradingMonitor();

    // Initialize All Lessons section
    initLessonsSection();

    // Debug: Check if token exists
    const token = localStorage.getItem('jwt_token');
    console.log('JWT token exists:', !!token);
});
