#!/usr/bin/env python3
"""
Systematic translation script: Chinese to English
Translates all Chinese text in TypeScript files to English
"""

import os
import re
from pathlib import Path

# Translation dictionary: Chinese -> English
TRANSLATIONS = {
    # Tool names and descriptions
    "开仓工具": "Open Position Tool",
    "平仓工具": "Close Position Tool",
    "取消订单工具": "Cancel Order Tool",
    "交易执行工具": "Trade Execution Tools",

    # Trading actions
    "开仓": "open position",
    "平仓": "close position",
    "止损": "stop-loss",
    "止盈": "take-profit",
    "做多": "long",
    "做空": "short",
    "加仓": "add to position",

    # Position types
    "多单": "long position",
    "空单": "short position",
    "持仓": "position",

    # Financial terms
    "杠杆": "leverage",
    "杠杆倍数": "leverage multiplier",
    "保证金": "margin",
    "强平价": "liquidation price",
    "合约": "contract",
    "张数": "contracts",
    "张": " contracts",

    # Account terms
    "账户": "account",
    "余额": "balance",
    "可用资金": "available balance",
    "可用余额": "available balance",
    "净值": "total balance",
    "总资产": "total balance",
    "未实现盈亏": "unrealized PnL",
    "已实现盈亏": "realized PnL",

    # PnL terms
    "盈亏": "PnL",
    "盈利": "profit",
    "亏损": "loss",
    "回撤": "drawdown",
    "峰值": "peak",
    "收益率": "return rate",
    "手续费": "fee",
    "总手续费": "total fees",
    "开仓手续费": "entry fee",
    "平仓手续费": "exit fee",

    # Order types and status
    "订单": "order",
    "挂单": "pending order",
    "市价单": "market order",
    "限价单": "limit order",
    "成交": "filled",
    "已取消": "cancelled",
    "未成交": "not filled",

    # Risk management
    "风控": "risk control",
    "风险管理": "risk management",
    "最大持仓": "max positions",
    "最大杠杆": "max leverage",
    "敞口": "exposure",
    "仓位": "position size",
    "风控检查": "risk check",
    "风控保护": "risk protection",

    # Symbols and pairs
    "币种": "symbol",
    "币种代码": "symbol code",
    "交易对": "trading pair",

    # Directions
    "方向": "direction",
    "买入": "buy",
    "卖出": "sell",

    # Time
    "时间": "time",
    "日期": "date",
    "开仓时间": "entry time",
    "平仓时间": "exit time",
    "持仓时长": "holding duration",

    # Messages and statuses
    "成功": "successful",
    "失败": "failed",
    "错误": "error",
    "警告": "warning",
    "无效的": "invalid",
    "必须": "must",
    "不能": "cannot",
    "已达到": "reached",
    "超过": "exceeds",
    "低于": "below",
    "高于": "above",

    # Operations
    "初始化": "initialize",
    "启动": "start",
    "停止": "stop",
    "重启": "restart",
    "检查": "check",
    "验证": "verify",
    "同步": "sync",
    "更新": "update",
    "插入": "insert",
    "删除": "delete",
    "查询": "query",
    "取消": "cancel",
    "修改": "modify",
    "触发": "triggered",

    # Common adjectives
    "当前": "current",
    "实际": "actual",
    "预估": "estimated",
    "目标": "target",
    "新": "new",
    "旧": "old",

    # Database
    "数据库": "database",

    # Specific messages (longer phrases should come first to avoid partial replacements)
    "禁止同时持有双向持仓": "dual-direction positions not allowed",
    "请先平掉": "please close",
    "后再开": "before opening",
    "双向持仓": "dual-direction position",
    "开仓金额": "position amount",
    "入场价": "entry price",
    "平仓价": "exit price",
    "价格变动": "price change",
    "名义价值": "notional value",
    "毛盈亏": "gross PnL",
    "净盈亏": "net PnL",
    "偏离": "deviation",
    "滑点": "slippage",
    "滑点保护": "slippage protection",
    "回滚": "rollback",
    "已回滚": "rolled back",
}

def translate_file(filepath: Path):
    """Translate a single file"""
    try:
        rel_path = filepath.relative_to(Path.cwd())
    except ValueError:
        rel_path = filepath
    print(f"Translating: {rel_path}")

    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    original_content = content

    # Sort translations by length (longest first) to avoid partial replacements
    sorted_translations = sorted(TRANSLATIONS.items(), key=lambda x: len(x[0]), reverse=True)

    for chinese, english in sorted_translations:
        content = content.replace(chinese, english)

    if content != original_content:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"  ✅ Translated")
        return True
    else:
        print(f"  ⏭️  No changes")
        return False

def main():
    """Main translation routine"""
    print("🌏 Chinese-to-English Translation Script")
    print("=" * 60)

    src_dir = Path("src")
    ts_files = list(src_dir.rglob("*.ts"))

    print(f"Found {len(ts_files)} TypeScript files\n")

    translated_count = 0

    for filepath in ts_files:
        if translate_file(filepath):
            translated_count += 1

    print("\n" + "=" * 60)
    print(f"✅ Translation complete!")
    print(f"📊 Translated {translated_count} / {len(ts_files)} files")
    print("\n⚠️  Please manually review:")
    print("   - AI tool descriptions and prompts")
    print("   - Complex log messages")
    print("   - Error messages for clarity")

if __name__ == "__main__":
    main()
