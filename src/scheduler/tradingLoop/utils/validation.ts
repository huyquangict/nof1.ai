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

/**
 * Number validation utilities
 *
 * These pure functions ensure numeric values are valid and within acceptable ranges.
 * Used throughout the trading system for data validation.
 */

/**
 * Ensure the value is a valid finite number, otherwise return the default value
 *
 * @param value - The number to validate
 * @param defaultValue - The default value to return if invalid (default: 0)
 * @returns The original value if finite, otherwise the default value
 *
 * @example
 * ensureFinite(42.5) // returns 42.5
 * ensureFinite(NaN) // returns 0
 * ensureFinite(Infinity, 100) // returns 100
 */
export function ensureFinite(value: number, defaultValue: number = 0): number {
  if (!Number.isFinite(value)) {
    return defaultValue;
  }
  return value;
}

/**
 * Ensure the value is within the specified range
 *
 * @param value - The number to validate and clamp
 * @param min - The minimum allowed value
 * @param max - The maximum allowed value
 * @param defaultValue - The default value to return if value is not finite (default: midpoint of range)
 * @returns The value clamped to the range [min, max]
 *
 * @example
 * ensureRange(50, 0, 100) // returns 50
 * ensureRange(150, 0, 100) // returns 100 (clamped to max)
 * ensureRange(-10, 0, 100) // returns 0 (clamped to min)
 * ensureRange(NaN, 0, 100) // returns 50 (midpoint)
 * ensureRange(Infinity, 0, 100, 75) // returns 75 (custom default)
 */
export function ensureRange(value: number, min: number, max: number, defaultValue?: number): number {
  if (!Number.isFinite(value)) {
    return defaultValue !== undefined ? defaultValue : (min + max) / 2;
  }
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
