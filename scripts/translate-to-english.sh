#!/bin/bash

# Translation script: Chinese to English
# This script systematically translates Chinese text to English in the codebase

set -e

echo "🌏 Starting Chinese-to-English translation..."

# Backup files before translation
echo "📦 Creating backup..."
git add -A
git stash push -m "backup-before-translation"

# Function to replace Chinese with English in all .ts files
translate_pattern() {
  local chinese="$1"
  local english="$2"
  echo "  Replacing: $chinese → $english"
  find src -name "*.ts" -type f -exec sed -i "s/$chinese/$english/g" {} \;
}

# Common trading terms
echo "📝 Translating trading terms..."
translate_pattern "开仓" "Open Position"
translate_pattern "平仓" "Close Position"
translate_pattern "止损" "Stop Loss"
translate_pattern "止盈" "Take Profit"
translate_pattern "做多" "Long"
translate_pattern "做空" "Short"
translate_pattern "杠杆" "Leverage"
translate_pattern "保证金" "Margin"
translate_pattern "强平价" "Liquidation Price"
translate_pattern "合约" "Contract"
translate_pattern "张数" "Contracts"

# Position and order terms
translate_pattern "持仓" "Position"
translate_pattern "订单" "Order"
translate_pattern "挂单" "Pending Order"
translate_pattern "市价单" "Market Order"
translate_pattern "限价单" "Limit Order"
translate_pattern "成交" "Filled"
translate_pattern "已取消" "Cancelled"
translate_pattern "未成交" "Not Filled"

# Account and balance terms
translate_pattern "账户" "Account"
translate_pattern "余额" "Balance"
translate_pattern "可用资金" "Available Balance"
translate_pattern "可用余额" "Available Balance"
translate_pattern "净值" "Total Balance"
translate_pattern "总资产" "Total Balance"
translate_pattern "未实现盈亏" "Unrealized PnL"
translate_pattern "已实现盈亏" "Realized PnL"

# PnL and performance terms
translate_pattern "盈亏" "PnL"
translate_pattern "盈利" "Profit"
translate_pattern "亏损" "Loss"
translate_pattern "回撤" "Drawdown"
translate_pattern "峰值" "Peak"
translate_pattern "收益率" "Return Rate"
translate_pattern "手续费" "Fee"
translate_pattern "总手续费" "Total Fee"

# Risk management terms
translate_pattern "风控" "Risk Control"
translate_pattern "风险管理" "Risk Management"
translate_pattern "最大持仓" "Max Positions"
translate_pattern "最大杠杆" "Max Leverage"
translate_pattern "敞口" "Exposure"
translate_pattern "仓位" "Position Size"

# Trading actions and statuses
translate_pattern "开仓成功" "Position opened successfully"
translate_pattern "开仓失败" "Failed to open position"
translate_pattern "平仓成功" "Position closed successfully"
translate_pattern "平仓失败" "Failed to close position"
translate_pattern "成功" "Success"
translate_pattern "失败" "Failed"
translate_pattern "错误" "Error"
translate_pattern "警告" "Warning"

# Directions
translate_pattern "多单" "Long Position"
translate_pattern "空单" "Short Position"
translate_pattern "方向" "Direction"
translate_pattern "买入" "Buy"
translate_pattern "卖出" "Sell"

# Database and system terms
translate_pattern "数据库" "Database"
translate_pattern "同步" "Sync"
translate_pattern "更新" "Update"
translate_pattern "插入" "Insert"
translate_pattern "删除" "Delete"
translate_pattern "查询" "Query"

# Time and dates
translate_pattern "时间" "Time"
translate_pattern "日期" "Date"
translate_pattern "开仓时间" "Entry Time"
translate_pattern "平仓时间" "Exit Time"
translate_pattern "持仓时长" "Holding Duration"

# Symbols and coins
translate_pattern "币种" "Symbol"
translate_pattern "币种代码" "Symbol code"
translate_pattern "交易对" "Trading Pair"

# Messages and descriptions
translate_pattern "无效的" "Invalid"
translate_pattern "必须" "must"
translate_pattern "不能" "cannot"
translate_pattern "已达到" "Reached"
translate_pattern "超过" "Exceeds"
translate_pattern "低于" "Below"
translate_pattern "高于" "Above"

# System operations
translate_pattern "初始化" "Initialize"
translate_pattern "启动" "Start"
translate_pattern "停止" "Stop"
translate_pattern "重启" "Restart"
translate_pattern "检查" "Check"
translate_pattern "验证" "Verify"

# Common phrases
translate_pattern "当前" "Current"
translate_pattern "实际" "Actual"
translate_pattern "预估" "Estimated"
translate_pattern "目标" "Target"
translate_pattern "触发" "Triggered"
translate_pattern "取消" "Cancel"
translate_pattern "修改" "Modify"

echo "✅ Translation complete!"
echo "📊 Reviewing changes..."
git diff --stat

echo ""
echo "✅ Done! Please review the changes with 'git diff'"
echo "⚠️  Remember to manually review AI prompts and complex descriptions"
