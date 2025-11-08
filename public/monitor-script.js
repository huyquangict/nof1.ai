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
        this.chartTimeframe = '24'; // Fixed 24 hours
        this.init();
    }

    async init() {
        await this.loadInitialData();
        this.initEquityChart();
        this.initTimeframeSelector();
        this.startDataUpdates();
        this.initTabs();
        this.initChat();
        this.duplicateTicker();
        this.loadGitHubStars(); // Load GitHub stars
    }

    // Load initial data
    async loadInitialData() {
        try {
            await Promise.all([
                this.loadAccountData(),
                this.loadPositionsData(),
                this.loadTradesData(),
                this.loadLogsData(),
                this.loadTickerPrices(),
                this.loadStatisticsData()
            ]);
        } catch (error) {
            console.error('Failed to load initial data:', error);
        }
    }

    // Load GitHub stars
    async loadGitHubStars() {
        try {
            const response = await fetch('https://api.github.com/repos/195440/open-nof1.ai');
            const data = await response.json();
            const starsCount = document.getElementById('stars-count');
            if (starsCount && data.stargazers_count !== undefined) {
                // Format star count (show k if over 1000)
                const count = data.stargazers_count;
                starsCount.textContent = count >= 1000 ? `${(count / 1000).toFixed(1)}k` : count;
            }
        } catch (error) {
            console.error('Failed to load GitHub stars:', error);
            const starsCount = document.getElementById('stars-count');
            if (starsCount) {
                starsCount.textContent = '-';
            }
        }
    }

    // Load account data
    async loadAccountData() {
        try {
            const response = await fetch('/api/account');
            const data = await response.json();

            if (data.error) {
                console.error('API error:', data.error);
                return;
            }

            this.accountData = data;

            // Use the same algorithm as app.js to calculate total assets
            // API returned totalBalance does not include unrealized P&L
            // Display total assets needs to add unrealized P&L to reflect real-time position P&L
            const totalBalanceWithPnl = data.totalBalance + data.unrealisedPnl;

            // Update total assets
        const accountValueEl = document.getElementById('account-value');
            if (accountValueEl) {
                accountValueEl.textContent = totalBalanceWithPnl.toFixed(2);
            }

            // Update available balance
            const availableBalanceEl = document.getElementById('available-balance');
            if (availableBalanceEl) {
                availableBalanceEl.textContent = data.availableBalance.toFixed(2);
            }

            // Update unrealized P&L (with sign and color)
            const unrealisedPnlEl = document.getElementById('unrealised-pnl');
            if (unrealisedPnlEl) {
                const pnlValue = (data.unrealisedPnl >= 0 ? '+' : '') + data.unrealisedPnl.toFixed(2);
                unrealisedPnlEl.textContent = pnlValue;
                unrealisedPnlEl.className = 'detail-value ' + (data.unrealisedPnl >= 0 ? 'positive' : 'negative');
            }

            // Update return (total assets - initial balance)
        const valueChangeEl = document.getElementById('value-change');
        const valuePercentEl = document.getElementById('value-percent');

            if (valueChangeEl && valuePercentEl) {
                // Return % = (total assets with unrealized P&L - initial balance) / initial balance * 100
                const totalPnl = totalBalanceWithPnl - data.initialBalance;
                const returnPercent = (totalPnl / data.initialBalance) * 100;
                const isPositive = totalPnl >= 0;

                valueChangeEl.textContent = `${isPositive ? '+' : ''}$${Math.abs(totalPnl).toFixed(2)}`;
                valuePercentEl.textContent = `(${isPositive ? '+' : ''}${returnPercent.toFixed(2)}%)`;

                // Update color
                valueChangeEl.className = 'change-amount ' + (isPositive ? '' : 'negative');
                valuePercentEl.className = 'change-percent ' + (isPositive ? '' : 'negative');
            }

        } catch (error) {
            console.error('Failed to load account data:', error);
        }
    }

    // Load positions data
    async loadPositionsData() {
        try {
            const response = await fetch('/api/positions');
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
                    positionsBody.innerHTML = '<tr><td colspan="8" class="empty-state">No positions</td></tr>';
                }
                // Update small cards
                if (positionsCardsContainer) {
                    positionsCardsContainer.innerHTML = '<div class="positions-cards-empty">No positions</div>';
                }
                return;
            }

            // Update crypto prices
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
                    return `
                        <tr>
                            <td>${pos.symbol}</td>
                            <td class="${sideClass}">${sideText}</td>
                            <td>${leverage}x</td>
                            <td>$${pos.entryPrice.toFixed(4)}</td>
                            <td>$${pos.openValue.toFixed(2)}</td>
                            <td>$${pos.currentPrice.toFixed(4)}</td>
                            <td class="${pos.unrealizedPnl >= 0 ? 'positive' : 'negative'}">
                                ${pos.unrealizedPnl >= 0 ? '+' : ''}$${pos.unrealizedPnl.toFixed(2)}
                            </td>
                            <td class="${pos.unrealizedPnl >= 0 ? 'positive' : 'negative'}">
                                ${pos.unrealizedPnl >= 0 ? '+' : ''}${profitPercent}%
                            </td>
                        </tr>
                    `;
                }).join('');
            }

            // Update position cards
            if (positionsCardsContainer) {
                positionsCardsContainer.innerHTML = data.positions.map(pos => {
                    const profitPercent = ((pos.unrealizedPnl / pos.openValue) * 100).toFixed(2);
                    const sideClass = pos.side;
                    const sideText = pos.side === 'long' ? 'L' : 'S';
                    const pnlClass = pos.unrealizedPnl >= 0 ? 'positive' : 'negative';
                    const leverage = pos.leverage || '-';

                    return `
                        <div class="position-card ${sideClass} ${pnlClass}">
                            <span class="position-card-symbol">${pos.symbol} ${leverage}x</span>
                            <span class="position-card-pnl ${pnlClass}">
                                ${sideText} ${pos.unrealizedPnl >= 0 ? '+' : ''}$${pos.unrealizedPnl.toFixed(2)} (${pos.unrealizedPnl >= 0 ? '+' : ''}${profitPercent}%)
                            </span>
                        </div>
                    `;
                }).join('');
            }

        } catch (error) {
            console.error('Failed to load positions data:', error);
        }
    }

    // Load trade history - using same layout as index.html
    async loadTradesData() {
        try {
            const response = await fetch('/api/trades?limit=100');
            const data = await response.json();

            if (data.error) {
                console.error('API error:', data.error);
                return;
            }

            const tradesBody = document.getElementById('trades-body');
            const countEl = document.getElementById('tradesCount');

            if (!data.trades || data.trades.length === 0) {
                if (tradesBody) {
                    tradesBody.innerHTML = '<tr><td colspan="9" class="empty-state">No trade history</td></tr>';
                }
                if (countEl) {
                    countEl.textContent = '';
                }
                return;
            }

            if (countEl) {
                countEl.textContent = `(${data.trades.length})`;
            }

            if (tradesBody) {
                tradesBody.innerHTML = data.trades.map(trade => {
                    const date = new Date(trade.timestamp);
                    const timeStr = date.toLocaleString('en-US', {
                        timeZone: 'Asia/Shanghai',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit'
                    });

                    // Type display
                    const typeText = trade.type === 'open' ? 'Open' : 'Close';
                    const typeClass = trade.type === 'open' ? 'buy' : 'sell';

                    // Direction display
                    const sideText = trade.side === 'long' ? 'Long' : 'Short';
                    const sideClass = trade.side === 'long' ? 'long' : 'short';

                    // P&L display (only for close trades)
                    const pnlHtml = trade.type === 'close' && trade.pnl !== null && trade.pnl !== undefined
                        ? `<span class="${trade.pnl >= 0 ? 'profit' : 'loss'}">${trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)}</span>`
                        : '<span class="na">-</span>';

                    return `
                        <tr>
                            <td>${timeStr}</td>
                            <td><span class="symbol">${trade.symbol}</span></td>
                            <td><span class="type ${typeClass}">${typeText}</span></td>
                            <td><span class="side ${sideClass}">${sideText}</span></td>
                            <td>${trade.price.toFixed(2)}</td>
                            <td>${trade.quantity}</td>
                            <td>${trade.leverage}x</td>
                            <td>${trade.fee.toFixed(4)}</td>
                            <td>${pnlHtml}</td>
                        </tr>
                    `;
                }).join('');
            }

        } catch (error) {
            console.error('Failed to load trade history:', error);
        }
    }

    // Load AI decision logs - show latest one with full content
    async loadLogsData() {
        try {
            const response = await fetch('/api/logs?limit=1');
            const data = await response.json();

            if (data.error) {
                console.error('API error:', data.error);
                return;
            }

            const decisionContent = document.getElementById('decision-content');
            const decisionMeta = document.getElementById('decision-meta');

            if (data.logs && data.logs.length > 0) {
                const log = data.logs[0]; // Only get the latest one

                // Update decision meta info
                if (decisionMeta) {
                    const timestamp = new Date(log.timestamp).toLocaleString('en-US', {
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
                    // Use marked library to convert markdown to HTML
                    const htmlContent = marked.parse(decision);

                    decisionContent.innerHTML = `<div class="decision-text markdown-content">${htmlContent}</div>`;
                }
            } else {
                if (decisionContent) {
                    decisionContent.innerHTML = '<p class="no-data">No AI decision records</p>';
                }
                if (decisionMeta) {
                    decisionMeta.innerHTML = '<span class="decision-time">No data</span>';
                }
            }

        } catch (error) {
            console.error('Failed to load logs:', error);
            const decisionContent = document.getElementById('decision-content');
            if (decisionContent) {
                decisionContent.innerHTML = `<p class="error">Loading failed: ${error.message}</p>`;
            }
        }
    }

    // Load ticker prices from API
    async loadTickerPrices() {
        try {
            const response = await fetch('/api/prices?symbols=BTC,ETH,SOL,BNB,DOGE,XRP');
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

    // Load statistics data
    async loadStatisticsData() {
        try {
            // Fetch trades and positions data
            const [tradesResponse, positionsResponse] = await Promise.all([
                fetch('/api/trades?limit=1000'),
                fetch('/api/positions')
            ]);

            const tradesData = await tradesResponse.json();
            const positionsData = await positionsResponse.json();

            // Active orders (current positions)
            const activeOrders = positionsData.positions ? positionsData.positions.length : 0;
            document.getElementById('stat-active-orders').textContent = activeOrders;

            if (!tradesData.trades || tradesData.trades.length === 0) {
                return;
            }

            const trades = tradesData.trades;

            // Total Orders (Long and Short) - only count open type orders
            const longOrders = trades.filter(t => t.type === 'open' && t.side === 'long').length;
            const shortOrders = trades.filter(t => t.type === 'open' && t.side === 'short').length;
            const totalOrders = longOrders + shortOrders;
            document.getElementById('stat-total-orders').textContent = totalOrders;
            document.getElementById('stat-total-long').textContent = `${longOrders}L`;
            document.getElementById('stat-total-short').textContent = `${shortOrders}S`;

            // Win Rate calculation (only count closed trades with P&L)
            const closedTrades = trades.filter(t => t.type === 'close' && t.pnl !== null && t.pnl !== undefined);
            const winTrades = closedTrades.filter(t => t.pnl > 0);
            const lossTrades = closedTrades.filter(t => t.pnl < 0);
            const totalClosedTrades = closedTrades.length;

            if (totalClosedTrades > 0) {
                const winRate = ((winTrades.length / totalClosedTrades) * 100).toFixed(1);
                document.getElementById('stat-win-rate-percent').textContent = `${winRate}%`;
                document.getElementById('stat-win-count').textContent = `${winTrades.length}W`;
                document.getElementById('stat-loss-count').textContent = `${lossTrades.length}L`;
            } else {
                document.getElementById('stat-win-rate-percent').textContent = '0%';
                document.getElementById('stat-win-count').textContent = '0W';
                document.getElementById('stat-loss-count').textContent = '0L';
            }

            // Total P&L
            const totalPnL = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
            const totalPnLEl = document.getElementById('stat-total-pnl');
            totalPnLEl.textContent = `$${totalPnL.toFixed(2)}`;
            totalPnLEl.className = 'stat-value';
            if (totalPnL > 0) {
                totalPnLEl.classList.add('positive');
            } else if (totalPnL < 0) {
                totalPnLEl.classList.add('negative');
            }

            // Best and Worst order
            // Best from all closed trades, Worst from loss trades only
            const bestOrderEl = document.getElementById('stat-best-order');
            const worstOrderEl = document.getElementById('stat-worst-order');

            if (winTrades.length > 0) {
                const bestPnL = Math.max(...winTrades.map(t => t.pnl));
                bestOrderEl.textContent = `$${bestPnL.toFixed(2)}`;
                bestOrderEl.className = 'stat-value-win';
            } else {
                bestOrderEl.textContent = '$0.00';
                bestOrderEl.className = 'stat-value-win';
            }

            if (lossTrades.length > 0) {
                const worstPnL = Math.min(...lossTrades.map(t => t.pnl));
                worstOrderEl.textContent = `$${worstPnL.toFixed(2)}`;
                worstOrderEl.className = 'stat-value-loss';
            } else {
                worstOrderEl.textContent = '$0.00';
                worstOrderEl.className = 'stat-value-loss';
            }

        } catch (error) {
            console.error('Failed to load statistics:', error);
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

        // Update trade history, logs, and statistics every 30 seconds
        setInterval(async () => {
            await Promise.all([
                this.loadTradesData(),
                this.loadLogsData(),
                this.loadStatisticsData()
            ]);
        }, 30000);

        // Update equity curve chart every 30 seconds
        setInterval(async () => {
            await this.updateEquityChart();
        }, 30000);
    }

    // Duplicate ticker content for seamless scrolling
    duplicateTicker() {
        const ticker = document.getElementById('ticker');
        if (ticker) {
            const tickerContent = ticker.innerHTML;
            ticker.innerHTML = tickerContent + tickerContent + tickerContent;
        }
    }

    // Initialize tabs (simplified, only one tab)
    initTabs() {
        // Already only one tab, no switching needed
    }

    // Initialize chat feature (removed)
    initChat() {
        // Chat feature has been removed
    }

    // Initialize equity curve chart
    async initEquityChart() {
        const ctx = document.getElementById('equityChart');
        if (!ctx) {
            console.error('Chart canvas element not found');
            return;
        }

        // Load historical data
        const historyData = await this.loadEquityHistory();

        console.log('Equity history data:', historyData);

        if (!historyData || historyData.length === 0) {
            console.log('No historical data, chart will display after data is available');
            // Show info message
            const container = ctx.parentElement;
            if (container) {
                const message = document.createElement('div');
                message.className = 'no-data';
                message.style.cssText = 'position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: #000000; text-align: center;';
                message.innerHTML = 'No historical data<br><small style="color: #666666;">System records account assets every 10 minutes</small>';
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
                    return date.toLocaleString('en-US', {
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
                        borderColor: 'rgb(0, 100, 255)',
                        backgroundColor: 'rgba(0, 100, 255, 0.1)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.4,
                        pointRadius: 0,
                        pointHoverRadius: 0
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
                        labels: {
                            color: '#000000',
                            usePointStyle: true,
                            padding: 15
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(255, 255, 255, 0.95)',
                        titleColor: '#000000',
                        bodyColor: '#000000',
                        borderColor: 'rgb(0, 0, 0)',
                        borderWidth: 1,
                        padding: 12,
                        displayColors: true,
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) {
                                    label += ': ';
                                }
                                if (context.parsed.y !== null) {
                                    label += '$' + context.parsed.y;
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
                            color: 'rgba(0, 0, 0, 0.1)',
                            drawBorder: false
                        },
                        ticks: {
                            color: '#000000',
                            maxRotation: 45,
                            minRotation: 0,
                            maxTicksLimit: 10
                        }
                    },
                    y: {
                        display: true,
                        position: 'left',
                        grid: {
                            color: 'rgba(0, 0, 0, 0.1)',
                            drawBorder: false
                        },
                        ticks: {
                            color: '#000000',
                            callback: function(value) {
                                return '$' + value.toFixed(2);
                            }
                        }
                    }
                }
            }
        });
    }

    // Load equity history data
    async loadEquityHistory() {
        try {
            // Get all historical data
            const response = await fetch(`/api/history`);
            const data = await response.json();

            if (data.error) {
                console.error('API error:', data.error);
                return [];
            }

            return data.history || [];
        } catch (error) {
            console.error('Failed to load equity history data:', error);
            return [];
        }
    }

    // Update equity curve chart
    async updateEquityChart() {
        if (!this.equityChart) {
            await this.initEquityChart();
            return;
        }

        const historyData = await this.loadEquityHistory();

        if (!historyData || historyData.length === 0) {
            return;
        }

        // Update chart data
        this.equityChart.data.labels = historyData.map(d => {
            const date = new Date(d.timestamp);
            return date.toLocaleString('en-US', {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
        });

        this.equityChart.data.datasets[0].data = historyData.map(d =>
            parseFloat(d.totalValue.toFixed(2))
        );

        // Always hide points
        this.equityChart.data.datasets[0].pointRadius = 0;

        this.equityChart.update('none'); // Update without animation
    }

    // Initialize timeframe selector (disabled)
    initTimeframeSelector() {
        // Timeframe is fixed at 24 hours, switching no longer supported
    }
}

// Initialize monitoring system
document.addEventListener('DOMContentLoaded', () => {
    const monitor = new TradingMonitor();
});
