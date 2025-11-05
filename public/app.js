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

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadAllData();

    // Refresh account and positions data every 3 seconds for real-time updates
    setInterval(async () => {
        await Promise.all([
            loadAccountData(),
            loadPositionsData()
        ]);
        updateLastUpdateTime();
    }, 3000);

    // Update AI decisions and trade history every 5 minutes
    setInterval(async () => {
        await Promise.all([
            loadLogsData(),
            loadTradesData()
        ]);
    }, 5 * 60 * 1000); // 5 minutes = 300000ms

    // Mobile optimization: add touch scrolling optimization
    initMobileOptimizations();

    // Page Visibility API - pause updates when page is not visible
    initVisibilityControl();
});

// Mobile optimizations
function initMobileOptimizations() {
    // Prevent double-tap zoom (only on non-input elements)
    let lastTouchEnd = 0;
    document.addEventListener('touchend', (event) => {
        const now = Date.now();
        if (now - lastTouchEnd <= 300) {
            // Don't prevent default behavior on input elements
            if (!event.target.matches('input, textarea, select')) {
                event.preventDefault();
            }
        }
        lastTouchEnd = now;
    }, { passive: false });

    // Mobile scroll optimization - let browser handle scrolling
    // Removed over-optimization code to allow normal panel scrolling
}

// Page visibility control
let updateInterval = null;
function initVisibilityControl() {
    let hidden, visibilityChange;

    if (typeof document.hidden !== "undefined") {
        hidden = "hidden";
        visibilityChange = "visibilitychange";
    } else if (typeof document.msHidden !== "undefined") {
        hidden = "msHidden";
        visibilityChange = "msvisibilitychange";
    } else if (typeof document.webkitHidden !== "undefined") {
        hidden = "webkitHidden";
        visibilityChange = "webkitvisibilitychange";
    }

    if (typeof document[hidden] !== "undefined") {
        document.addEventListener(visibilityChange, () => {
            if (document[hidden]) {
                // When page is hidden, reduce update frequency or pause
                console.log('Page hidden, pausing updates');
            } else {
                // When page is visible, update immediately
                console.log('Page visible, resuming updates');
                loadAllData();
            }
        }, false);
    }
}

// Load all data
async function loadAllData() {
    await Promise.all([
        loadAccountData(),
        loadPositionsData(),
        loadLogsData(),
        loadTradesData()
    ]);

    updateLastUpdateTime();
}

// Load account data
async function loadAccountData() {
    try {
        const response = await fetch('/api/account');
        const data = await response.json();


        // Update available balance
        updateValueWithAnimation('availableBalance', data.availableBalance.toFixed(2));

        // Update unrealized P&L (with sign and color)
        // This value updates in real-time based on position prices
        const unrealisedPnlEl = document.getElementById('unrealisedPnl');
        const pnlValue = (data.unrealisedPnl >= 0 ? '+' : '') + data.unrealisedPnl.toFixed(2);
        updateValueWithAnimation('unrealisedPnl', pnlValue);
        unrealisedPnlEl.className = 'value ' + (data.unrealisedPnl >= 0 ? 'positive' : 'negative');

        // Update total assets
        // API returned totalBalance does not include unrealized P&L
        // Display total assets needs to add unrealized P&L to reflect real-time position P&L
        const totalBalanceWithPnl = data.totalBalance + data.unrealisedPnl;
        updateValueWithAnimation('totalBalance', totalBalanceWithPnl.toFixed(2));

        // Update return percentage (with sign and color)
        // Return % = (total assets - initial balance) / initial balance * 100
        // Using total assets with unrealized P&L, updates in real-time
        const returnPercentEl = document.getElementById('returnPercent');
        const returnPercent = ((totalBalanceWithPnl - data.initialBalance) / data.initialBalance) * 100;
        const returnValue = (returnPercent >= 0 ? '+' : '') + returnPercent.toFixed(2) + '%';
        updateValueWithAnimation('returnPercent', returnValue);
        returnPercentEl.className = 'value ' + (returnPercent >= 0 ? 'positive' : 'negative');

    } catch (error) {
        console.error('Failed to load account data:', error);
    }
}

// Update value with animation effect
function updateValueWithAnimation(elementId, newValue) {
    const element = document.getElementById(elementId);
    if (!element) return;

    const oldValue = element.textContent;

    // If value hasn't changed, don't update
    if (oldValue === newValue) return;

    // Add flash effect to indicate data update
    element.style.transition = 'background-color 0.3s ease';
    element.style.backgroundColor = 'rgba(59, 130, 246, 0.2)';

    // Update value
    element.textContent = newValue;

    // Restore background color
    setTimeout(() => {
        element.style.backgroundColor = '';
    }, 300);
}

// Load positions data
async function loadPositionsData() {
    try {
        const response = await fetch('/api/positions');
        const data = await response.json();
        
        const container = document.getElementById('positionsContainer');
        const countEl = document.getElementById('positionsCount');
        
        if (!data.positions || data.positions.length === 0) {
            container.innerHTML = '<p class="no-data">No positions</p>';
            countEl.textContent = '';
            return;
        }

        countEl.textContent = `(${data.positions.length})`;

        container.innerHTML = data.positions.map(pos => `
            <div class="position-item ${pos.side}">
                <div class="position-header">
                    <div class="position-symbol">${pos.symbol}</div>
                    <div class="position-side ${pos.side}">${pos.side === 'long' ? 'L' : 'S'}</div>
                </div>
                <div class="position-grid">
                    <div class="position-field">
                        <div class="label">Quantity</div>
                        <div class="value">${pos.quantity}</div>
                    </div>
                    <div class="position-field">
                        <div class="label">Entry Price</div>
                        <div class="value">${pos.entryPrice.toFixed(4)}</div>
                    </div>
                    <div class="position-field">
                        <div class="label">Position Value</div>
                        <div class="value">${pos.openValue.toFixed(2)} USDT</div>
                    </div>
                    <div class="position-field">
                        <div class="label">Current Price</div>
                        <div class="value">${pos.currentPrice.toFixed(4)}</div>
                    </div>
                    <div class="position-field">
                        <div class="label">Leverage</div>
                        <div class="value">${pos.leverage}x</div>
                    </div>
                    <div class="position-field">
                        <div class="label">P&L</div>
                        <div class="value ${pos.unrealizedPnl >= 0 ? 'positive' : 'negative'}">
                            ${(pos.unrealizedPnl >= 0 ? '+' : '')}${pos.unrealizedPnl.toFixed(2)}
                        </div>
                    </div>
                    <div class="position-field">
                        <div class="label">Liq. Price</div>
                        <div class="value">${pos.liquidationPrice.toFixed(4)}</div>
                    </div>
                    ${pos.stopLoss ? `
                    <div class="position-field">
                        <div class="label">Stop Loss</div>
                        <div class="value">${pos.stopLoss.toFixed(4)}</div>
                    </div>
                    ` : ''}
                    ${pos.profitTarget ? `
                    <div class="position-field">
                        <div class="label">Take Profit</div>
                        <div class="value">${pos.profitTarget.toFixed(4)}</div>
                    </div>
                    ` : ''}
                </div>
            </div>
        `).join('');

    } catch (error) {
        console.error('Failed to load positions data:', error);
    }
}

// Load AI decision logs
async function loadLogsData() {
    try {
        const response = await fetch('/api/logs?limit=1');
        const data = await response.json();

        const container = document.getElementById('logsContainer');

        if (!data.logs || data.logs.length === 0) {
            container.innerHTML = '<p class="no-data">No decision logs</p>';
            return;
        }
        
        container.innerHTML = data.logs.map((log, index) => {
            const date = new Date(log.timestamp);
            const timeStr = date.toLocaleString('en-US', {
                timeZone: 'Asia/Shanghai',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });

            return `
                <div class="log-item">
                    <div class="log-header">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <div class="log-time">${timeStr}</div>
                            <div class="log-iteration">#${log.iteration}</div>
                        </div>
                        <button class="copy-btn" onclick="copyLog(${index})" title="Copy decision content">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                        </button>
                    </div>
                    <div class="log-decision" id="log-decision-${index}">${log.decision}</div>
                </div>
            `;
        }).join('');

        // Save log data for copy functionality
        window.logsData = data.logs;

    } catch (error) {
        console.error('Failed to load logs:', error);
    }
}

// Load trade history
async function loadTradesData() {
    try {
        // Don't pass contract parameter to get all contracts' trade records
        const response = await fetch('/api/trades?limit=100');
        const data = await response.json();

        const container = document.getElementById('tradesContainer');
        const countEl = document.getElementById('tradesCount');

        if (!data.trades || data.trades.length === 0) {
            container.innerHTML = '<p class="no-data">No trade history</p>';
            countEl.textContent = '';
            return;
        }

        countEl.textContent = `(${data.trades.length})`;

        container.innerHTML = data.trades.map(trade => {
            const date = new Date(trade.timestamp);
            const timeStr = date.toLocaleString('en-US', {
                timeZone: 'Asia/Shanghai',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });

            // For close trades, display P&L
            const pnlHtml = trade.type === 'close' && trade.pnl !== null && trade.pnl !== undefined
                ? `<div class="trade-field">
                    <span class="label">P&L</span>
                    <span class="value ${trade.pnl >= 0 ? 'profit' : 'loss'}">${trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)} USDT</span>
                   </div>`
                : '';

            return `
                <div class="trade-item">
                    <div class="trade-header">
                        <div class="trade-symbol">${trade.symbol}</div>
                        <div class="trade-time">${timeStr}</div>
                    </div>
                    <div class="trade-info">
                        <div class="trade-field">
                            <span class="label">Direction</span>
                            <span class="value ${trade.side}">${trade.side === 'long' ? 'Long' : trade.side === 'short' ? 'Short' : '-'}</span>
                        </div>
                        <div class="trade-field">
                            <span class="label">Type</span>
                            <span class="value">${trade.type === 'open' ? 'Open' : 'Close'}</span>
                        </div>
                        <div class="trade-field">
                            <span class="label">Quantity</span>
                            <span class="value">${trade.quantity.toFixed(4)}</span>
                        </div>
                        <div class="trade-field">
                            <span class="label">Price</span>
                            <span class="value">${trade.price.toFixed(4)}</span>
                        </div>
                        <div class="trade-field">
                            <span class="label">Leverage</span>
                            <span class="value">${trade.leverage}x</span>
                        </div>
                        <div class="trade-field">
                            <span class="label">Fee</span>
                            <span class="value">${trade.fee.toFixed(4)}</span>
                        </div>
                        ${pnlHtml}
                    </div>
                </div>
            `;
        }).join('');

    } catch (error) {
        console.error('Failed to load trade history:', error);
    }
}

// Update last update time
function updateLastUpdateTime() {
    const now = new Date();
    document.getElementById('lastUpdate').textContent = now.toLocaleTimeString('en-US', {
        timeZone: 'Asia/Shanghai',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

// Copy log decision content
function copyLog(index) {
    if (!window.logsData || !window.logsData[index]) {
        console.error('Log data does not exist');
        return;
    }

    const log = window.logsData[index];
    const logText = `Time: ${new Date(log.timestamp).toLocaleString('en-US', { timeZone: 'Asia/Shanghai' })}\nIteration: #${log.iteration}\n\nDecision:\n${log.decision}`;

    navigator.clipboard.writeText(logText).then(() => {
        // Show copy success indication
        const btn = event.target.closest('.copy-btn');
        if (btn) {
            const originalHTML = btn.innerHTML;
            btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
            btn.style.color = '#10b981';

            setTimeout(() => {
                btn.innerHTML = originalHTML;
                btn.style.color = '';
            }, 2000);
        }
    }).catch(err => {
        console.error('Copy failed:', err);
        alert('Copy failed, please copy manually');
    });
}
