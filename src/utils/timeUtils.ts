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
 * Time utility module - standardized to China time (UTC+8)
 */

/**
 * Get current China time as ISO string
 * @returns ISO format string in China time
 */
export function getChinaTimeISO(): string {
  const now = new Date();
  
  // Use toLocaleString to get China time, then convert to ISO format
  const chinaTimeString = now.toLocaleString('zh-CN', { 
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  // 转换格式:从 "2025/10/23 08:30:45" 到 "2025-10-23T08:30:45+08:00"
  const [datePart, timePart] = chinaTimeString.split(' ');
  const isoDate = datePart.replace(/\//g, '-');
  return `${isoDate}T${timePart}+08:00`;
}

/**
 * 格式化中国time为易读格式
 * @param date date对象 or  ISO 字符串
 * @returns 格式化 中国time字符串,如 "2025-10-22 14:30:45"
 */
export function formatChinaTime(date?: Date | string): string {
  let d: Date;
  
  if (!date) {
    d = new Date();
  } else if (typeof date === 'string') {
    d = new Date(date);
  } else {
    d = date;
  }
  
  // 使用 toLocaleString 方法直接获取中国time
  const chinaTimeString = d.toLocaleString('zh-CN', { 
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  // 转换格式:从 "2025/10/23 08:30:45" 到 "2025-10-23 08:30:45"
  return chinaTimeString.replace(/\//g, '-');
}

/**
 * 获取中国time date对象
 * @returns 中国time  Date 对象(note:Date对象本身不存储时区,只是调整time值)
 */
export function getChinaTime(): Date {
  const now = new Date();
  
  // 使用 toLocaleString 获取中国time字符串
  const chinaTimeString = now.toLocaleString('zh-CN', { 
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  // 解析并创建new Date对象
  // 格式: "2025/10/23 08:30:45"
  const [datePart, timePart] = chinaTimeString.split(' ');
  const [year, month, day] = datePart.split('/');
  const [hour, minute, second] = timePart.split(':');
  
  // 创建UTCtime,但值对should中国time
  return new Date(Date.UTC(
    parseInt(year),
    parseInt(month) - 1,
    parseInt(day),
    parseInt(hour),
    parseInt(minute),
    parseInt(second)
  ));
}

/**
 * 将 UTC time转换为中国time字符串
 * @param utcDate UTC time
 * @returns 中国time字符串
 */
export function utcToChinaTime(utcDate: Date | string): string {
  const d = typeof utcDate === 'string' ? new Date(utcDate) : utcDate;
  return formatChinaTime(d);
}

/**
 * 获取中国time戳(毫秒)
 * @returns 中国time time戳
 */
export function getChinaTimestamp(): number {
  return getChinaTime().getTime();
}

