#!/usr/bin/env python3
"""
Comprehensive translation script: Replace all Chinese text
Manually targets every specific Chinese phrase found in the codebase
"""

import re
from pathlib import Path

# File-level replacements (headers, module descriptions)
FILE_PATTERNS = [
    (r"AI 加密货币自动交易系统", "AI Cryptocurrency Automated Trading System"),
    (r"加密货币自动交易系统", "Cryptocurrency Automated Trading System"),
    (r"交易执行工具", "Trade Execution Tools"),
    (r"市场数据工具", "Market Data Tools"),
    (r"账户管理工具", "Account Management Tools"),
    (r"交易工具集导出", "Trading Tools Exports"),
    (r"API 路由", "API Routes"),
    (r"多time框架分析模块（极简版 - 只提供原始数据）", "Multi-timeframe analysis module (minimal version - provides raw data only)"),
    (r"基础风险参数配置（从环境变量读取，支持灵活配置）", "Basic risk parameter configuration (read from environment variables for flexible configuration)"),
    (r"time工具模块 - 统一使用中国time（UTC\+8）", "Time utility module - standardized to China time (UTC+8)"),
    (r"工具函数导出", "Utility function exports"),
    (r"contract工具函数", "Contract utility functions"),
    (r"database模式定义", "Database schema definition"),
    (r"databaseinitialize脚本", "Database initialization script"),
    (r"database迁移脚本：添加 peak_pnl_percent 字段到 positions 表", "Database migration script: add peak_pnl_percent field to positions table"),
    (r"close position并重置database脚本", "Close positions and reset database script"),
    (r"用于在运行时快速重置系统状态", "Used for quick system state reset at runtime"),
    (r"快速syncposition（不重置database）", "Quick position sync (without resetting database)"),
    (r"只从交易所syncposition到本地database", "Only sync positions from exchange to local database"),
    (r"强制重newinitializedatabase", "Force reinitialize database"),
    (r"清空所有数据并重new创建表", "Clear all data and recreate tables"),
    (r"给trades表添加fee字段", "Add fee field to trades table"),
]

# Comment and message patterns
COMMENT_PATTERNS = [
    # Configuration and parameters
    (r"从环境变量读取交易symbol列表（逗号分隔）", "Read trading symbol list from environment variable (comma-separated)"),
    (r"从环境变量读取配置，提供默认值", "Read configuration from environment variables with default values"),
    (r"max positions数", "Maximum number of positions"),
    (r"最大leverage multiplier", "Maximum leverage multiplier"),
    (r"交易symbol列表（作为元组以支持 zod\.enum）", "Trading symbol list (as tuple to support zod.enum)"),
    (r"max positions小时数", "Maximum holding hours"),
    (r"max positions周期数（根据position小时数自动计算：小时数 \* 6，因为每10分钟一个周期）", "Maximum holding cycles (auto-calculated based on holding hours: hours * 6, as each cycle is 10 minutes)"),
    (r"accountdrawdownrisk control阈值", "Account drawdown risk control thresholds"),
    (r"禁止newopen position的drawdown阈值（达到此阈值时，只允许close position不允许open position）", "Drawdown threshold to prohibit new positions (when reached, only close positions allowed, no new positions)"),
    (r"强制close position的drawdown阈值（达到此阈值时，立即close position所有position并stop交易）", "Drawdown threshold to force close all positions (when reached, immediately close all positions and stop trading)"),
    (r"warning提醒的drawdown阈值（达到此阈值时，提醒谨慎交易）", "Drawdown threshold for warning alerts (when reached, warn to trade cautiously)"),

    # Function comments
    (r"time框架定义", "Timeframe definition"),
    (r"标准time框架配置 - 短线交易配置", "Standard timeframe configuration - short-term trading configuration"),
    (r"确保数值是有效的有限数字，否则返回默认值", "Ensure value is a valid finite number, otherwise return default value"),
    (r"确保数值在指定范围内", "Ensure value is within specified range"),
    (r"计算 EMA", "Calculate EMA"),
    (r"计算EMA", "Calculate EMA"),
    (r"计算RSI", "Calculate RSI"),
    (r"计算MACD", "Calculate MACD"),
    (r"确保RSI在0-100范围内", "Ensure RSI is within 0-100 range"),
    (r"单个time框架的原始数据", "Raw data for a single timeframe"),
    (r"均线", "Moving averages"),
    (r"filled量", "Volume"),
    (r"价格变化", "Price change"),
    (r"最近20根K线变化%", "Change % in last 20 candles"),
    (r"分析单个time框架（只计算原始指标）", "Analyze a single timeframe (calculate raw indicators only)"),
    (r"获取K线数据", "Get candlestick data"),
    (r"提取价格和filled量数据", "Extract price and volume data"),
    (r"计算技术指标（原始值）", "Calculate technical indicators (raw values)"),
    (r"多time框架原始数据", "Multi-timeframe raw data"),
    (r"各time框架原始数据", "Raw data for each timeframe"),
    (r"关键价位（支撑阻力）", "Key levels (support/resistance)"),
    (r"执行多time框架分析（极简版 - 只提供原始数据）", "Perform multi-timeframe analysis (minimal version - provides raw data only)"),
    (r"并行获取所有time框架数据", "Fetch all timeframe data in parallel"),
    (r"计算支撑阻力位（基于价格数据）", "Calculate support/resistance levels (based on price data)"),
    (r"计算关键价位（支撑阻力）", "Calculate key price levels (support/resistance)"),
    (r"收集所有time框架的关键价格", "Collect key prices from all timeframes"),
    (r"简单的支撑阻力位计算（基于价格聚类）", "Simple support/resistance calculation (based on price clustering)"),
    (r"参数verify", "Parameter verification"),
    (r"参数验证", "Parameter validation"),

    # Database and system operations
    (r"开始database迁移：添加 peak_pnl_percent 字段\.\.\.", "Starting database migration: adding peak_pnl_percent field..."),
    (r"check字段是否已存在", "Check if field already exists"),
    (r"字段已存在，无需迁移", "field already exists, no migration needed"),
    (r"连接database", "Connect to database"),
    (r"database路径", "Database path"),
    (r"checktrades表结构\.\.\.", "Checking trades table structure..."),
    (r"checkfee列是否已存在", "Check if fee column already exists"),
    (r"query最近5条交易记录\.\.\.", "Query last 5 trade records..."),
    (r"没有交易记录", "No trade records"),
    (r"交易记录：", "Trade records:"),
    (r"从交易所syncposition\.\.\.", "Syncing positions from exchange..."),
    (r"连接database", "Connecting to database"),
    (r"当前无position", "No current positions"),
    (r"position同步完成", "Position sync complete"),
    (r"同步failed：", "Sync failed:"),
    (r"获取 (\\S+) currentposition\.\.\.", r"Fetching current positions from \1..."),
    (r"获取 (\\S+) 多time框架数据\.\.\.", r"Fetching multi-timeframe data for \1..."),
    (r"获取 (\\S+) (\\S+) 数据failed:", r"Failed to fetch \2 data for \1:"),
    (r"(\\S+) 多time框架数据获取完成", r"Multi-timeframe data fetch complete for \1"),

    # Time and date
    (r"获取current中国time的 ISO 字符串", "Get current China time as ISO string"),
    (r"中国time的 ISO 格式字符串", "ISO format string in China time"),
    (r"使用 toLocaleString 获取中国time，然后转换为 ISO 格式", "Use toLocaleString to get China time, then convert to ISO format"),
    (r"设置时区为中国time（Asia/Shanghai，UTC\\+8）", "Set timezone to China time (Asia/Shanghai, UTC+8)"),
    (r"创建日志实例（使用中国时区）", "Create logger instance (using China timezone)"),
    (r"使用系统时区设置，已经是 Asia/Shanghai", "Using system timezone setting, already set to Asia/Shanghai"),
    (r"正确格式化：使用 toLocaleString 获取中国time，然后转换为 ISO 格式", "Correct formatting: use toLocaleString to get China time, then convert to ISO format"),

    # Contract and trading
    (r"contract乘数缓存（避免重复API调用）", "Contract multiplier cache (avoid duplicate API calls)"),
    (r"默认contract乘数映射", "Default contract multiplier mapping"),
    (r"从交易所 API 获取failed时使用", "Used when fetching from exchange API fails"),
    (r"静态文件服务 - 需要使用绝对路径", "Static file service - requires absolute paths"),
    (r"获取account总览", "Get account overview"),
    (r"交易所account结构：", "Exchange account structure:"),
    (r"获取accountbalance工具", "Get account balance tool"),
    (r"获取accountbalance和资金信息", "Get account balance and funding information"),
    (r"获取accountbalancefailed:", "Failed to get account balance:"),
    (r"account管理工具", "Account management tools"),
    (r"市场数据工具", "Market data tools"),

    # Status and messages
    (r"无效的", "Invalid"),
    (r"invalidleverage multiplier:", "Invalid leverage multiplier:"),
    (r"must在(\\d+)-(\\d+)之间", r"must be between \1 and \2"),
    (r"最大值由环境变量MAX_LEVERAGE控制", "max value controlled by MAX_LEVERAGE environment variable"),
    (r"无法获取 (\\S+) 的 (\\S+) K线数据", r"Unable to fetch \2 candle data for \1"),
    (r"open position - long或short指定symbol（使用market order，立即以current市场价格filled）", "Open position - long or short specified symbol (using market order, immediately filled at current market price)"),
    (r"open position前must先用getAccountBalance和getPositions工具queryavailable balance和现有position，避免资金不足", "Before opening position, must first use getAccountBalance and getPositions tools to query available balance and existing positions to avoid insufficient funds"),
    (r"自动cancel该symbol的所有遗留SL/TPorder（defensive programming - 无需手动调用cancelAllOrdersForSymbol）", "Automatically cancel all legacy SL/TP orders for this symbol (defensive programming - no need to manually call cancelAllOrdersForSymbol)"),
    (r"交易fee约0\.05%，避免频繁交易", "Trading fee approximately 0.05%, avoid frequent trading"),
    (r"系统会自动设置stop-loss（SL）order保护position size，无需手动设置", "System will automatically set stop-loss (SL) orders to protect position size, no manual setup needed"),
    (r"take-profit（TP）由利润管理器根据profit水平自动动态调整（\\+8% → 锁定\\+3%, \\+15% → 锁定\\+8%, \\+25% → 锁定\\+15%）", "Take-profit (TP) automatically adjusted dynamically by profit manager based on profit level (+8% → lock +3%, +15% → lock +8%, +25% → lock +15%)"),
    (r"你只需专注于开close position决策", "You only need to focus on open/close position decisions"),
    (r"leverage multiplier（(\\d+)-(\\d+)倍，根据环境变量MAX_LEVERAGE配置）", r"Leverage multiplier (\1-\2x, configured via MAX_LEVERAGE environment variable)"),
    (r"open position时不设置take-profitstop-loss，由 AI 在每个周期主动决策", "No take-profit/stop-loss set when opening position, AI actively decides in each cycle"),
    (r"无效的开仓金额:", "Invalid position amount:"),
    (r"已达到最大持仓数量限制（(\\d+)个），当前持仓 (\\d+) 个，无法开新仓", r"Reached maximum position limit (\1), currently holding \2 positions, cannot open new position"),

    # Scheduler comments
    (r"old格式 \\(FuturesCandlestick\\)", "old format (FuturesCandlestick)"),

    # Special Chinese characters in strings (log messages, errors, etc)
    (r"开", "open"),
    (r"平", "close"),
    (r"（", "("),
    (r"）", ")"),
    (r"：", ":"),
    (r"，", ","),
    (r"。", "."),
]

def translate_file(filepath: Path):
    """Translate Chinese text in a TypeScript file"""
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    original_content = content

    # Apply file-level patterns
    for chinese, english in FILE_PATTERNS:
        content = re.sub(chinese, english, content)

    # Apply comment patterns
    for chinese, english in COMMENT_PATTERNS:
        content = re.sub(chinese, english, content)

    if content != original_content:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        return True
    return False

def main():
    """Main translation routine"""
    print("🌏 Comprehensive Chinese-to-English Translation")
    print("=" * 70)

    src_dir = Path("src")
    ts_files = list(src_dir.rglob("*.ts"))

    print(f"Found {len(ts_files)} TypeScript files\n")

    translated_count = 0
    for filepath in ts_files:
        if translate_file(filepath):
            print(f"✅ {filepath.relative_to(src_dir)}")
            translated_count += 1

    print("\n" + "=" * 70)
    print(f"✅ Translation complete!")
    print(f"📊 Translated {translated_count} files")

if __name__ == "__main__":
    main()
