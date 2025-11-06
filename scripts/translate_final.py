#!/usr/bin/env python3
"""
Final translation pass: Fix remaining Chinese text
Targets specific mixed phrases and remaining Chinese characters
"""

import re
from pathlib import Path

# Specific mixed phrases and remaining Chinese (longest first to avoid partial matches)
FINAL_REPLACEMENTS = [
    # Tool descriptions with mixed English/Chinese
    (r"take-profit\(TP\)由利润管理器根据profit水close自动动态调整\(", "take-profit (TP) automatically adjusted dynamically by profit manager based on profit level ("),
    (r"\+8% → 锁定\+3%, \+15% → 锁定\+8%, \+25% → 锁定\+15%", "+8% → lock +3%, +15% → lock +8%, +25% → lock +15%"),
    (r"leverage multiplier\((\\d+)-(\\d+)倍,根据环境变量MAX_LEVERAGE配置\)", r"leverage multiplier (\1-\2x, configured via MAX_LEVERAGE environment variable)"),

    # Messages with partial translation
    (r"open position前强制risk check", "Forced risk check before opening position"),
    (r"checkposition数量\(最多(\\d+)个\)", r"Check position count (max \1)"),
    (r"check该symbol是否已有position\(禁止dual-direction position\)", "Check if symbol already has position (dual-direction positions not allowed)"),
    (r"reachedMaximum number of positions量限制\((\\d+)个\),currentposition (\\d+) 个,无法opennew仓", r"Reached maximum position limit (\1), currently holding \2 positions, cannot open new position"),
    (r"已有(\\$\\{existingSide === \"long\" \\? \"多\" : \"空\"\\})单position", r"Already has ${existingSide === 'long' ? 'long' : 'short'} position"),
    (r"dual-direction positions not allowed\.please close(\\$\\{existingSide === \"long\" \\? \"多\" : \"空\"\\})单before opening(\\$\\{side === \"long\" \\? \"多\" : \"空\"\\})单\.", r"Dual-direction positions not allowed. Please close ${existingSide === 'long' ? 'long' : 'short'} position before opening ${side === 'long' ? 'long' : 'short'} position."),
    (r"已有(\\$\\{side === \"long\" \\? \"多\" : \"空\"\\})单position,允许add to position", r"Already has ${side === 'long' ? 'long' : 'short'} position, adding to position allowed"),
    (r"如果direction相同,允许add to position\(但需要注意总position限制\)", "If same direction, adding to position allowed (note total position limit)"),

    # Direction indicators
    (r"\\$\\{existingSide === \"long\" \\? \"多\" : \"空\"\\}", r"${existingSide === 'long' ? 'long' : 'short'}"),
    (r"\\$\\{side === \"long\" \\? \"多\" : \"空\"\\}", r"${side === 'long' ? 'long' : 'short'}"),
    (r"多单", "long position"),
    (r"空单", "short position"),
    (r"开多", "open long"),
    (r"开空", "open short"),
    (r"平多", "close long"),
    (r"平空", "close short"),

    # Common Chinese phrases
    (r"已有", "Already has"),
    (r"允许", "allowed"),
    (r"禁止", "not allowed"),
    (r"如果", "If"),
    (r"相同", "same"),
    (r"但需要注意", "but note"),
    (r"无法", "cannot"),
    (r"必须", "must"),
    (r"需要", "need"),
    (r"可以", "can"),
    (r"应该", "should"),
    (r"可能", "may"),
    (r"会", "will"),
    (r"应", "should"),

    # Position and status
    (r"currentposition", "currently holding"),
    (r"opennew仓", "open new position"),
    (r"newopen position", "open new position"),
    (r"close position", "close position"),
    (r"add to position", "add to position"),

    # Check and verify
    (r"check", "check"),
    (r"verify", "verify"),
    (r"limit", "limit"),
    (r"reached", "reached"),

    # Numbers and quantities
    (r"(\\d+)个", r"\1"),
    (r"([\\d\\.]+)倍", r"\1x"),
    (r"数量", "count"),
    (r"个", ""),
    (r"倍", "x"),

    # Messages
    (r"must在", "must be"),
    (r"之间", "between"),
    (r"最多", "max"),
    (r"最大值", "max value"),
    (r"最小值", "min value"),
    (r"根据", "according to"),
    (r"环境变量", "environment variable"),
    (r"配置", "configured"),
    (r"控制", "controlled"),
    (r"由", "by"),

    # Special markers and punctuation
    (r"注意", "note"),
    (r"：", ":"),
    (r"（", "("),
    (r"）", ")"),
    (r"，", ", "),
    (r"。", "."),
    (r"、", ", "),
    (r"的", " "),
    (r"了", ""),
    (r"和", " and "),
    (r"或", " or "),
    (r"与", " and "),

    # SQL and database comments in schema
    (r"-- 交易记录表", "-- Trade records table"),
    (r"历史最高PnL百分比\(考虑leverage\)", "Historical peak PnL percentage (considering leverage)"),

    # Status characters
    (r"开", "open"),
    (r"平", "close"),
]

def translate_file(filepath: Path):
    """Apply final translation pass"""
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    original_content = content

    # Apply all final replacements (sorted by length, longest first)
    sorted_replacements = sorted(FINAL_REPLACEMENTS, key=lambda x: len(x[0]), reverse=True)

    for pattern, replacement in sorted_replacements:
        content = re.sub(pattern, replacement, content)

    if content != original_content:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        return True
    return False

def main():
    """Main translation routine"""
    print("🌏 Final Translation Pass - Cleanup Remaining Chinese")
    print("=" * 70)

    src_dir = Path("src")
    ts_files = list(src_dir.rglob("*.ts"))

    print(f"Processing {len(ts_files)} TypeScript files\n")

    translated_count = 0
    for filepath in ts_files:
        if translate_file(filepath):
            print(f"✅ {filepath.relative_to(src_dir)}")
            translated_count += 1

    print("\n" + "=" * 70)
    print(f"✅ Final pass complete!")
    print(f"📊 Updated {translated_count} files")

if __name__ == "__main__":
    main()
