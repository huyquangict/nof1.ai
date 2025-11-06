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
  
  // convert format: from "2025/10/23 08:30:45" to "2025-10-23T08:30:45+08:00"
  const [datePart, timePart] = chinaTimeString.split(' ');
  const isoDate = datePart.replace(/\//g, '-');
  return `${isoDate}T${timePart}+08:00`;
}

/**
 * format China time to readable format
 * @param date date object or  ISO string
 * @returns formatted China time string, such as "2025-10-22 14:30:45"
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
  
  // use toLocaleString method to directly get China time
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
  
  // convert format: from "2025/10/23 08:30:45" to "2025-10-23 08:30:45"
  return chinaTimeString.replace(/\//g, '-');
}

/**
 * get China time date object
 * @returns China time  Date object (note: Date object itself does not store timezone, only adjusts time value)
 */
export function getChinaTime(): Date {
  const now = new Date();
  
  // use toLocaleString to get China time string
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
  
  // parse and create new Date object
  // format: "2025/10/23 08:30:45"
  const [datePart, timePart] = chinaTimeString.split(' ');
  const [year, month, day] = datePart.split('/');
  const [hour, minute, second] = timePart.split(':');
  
  // create UTC time, but value corresponds to China time
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
 * convert UTC time to China time string
 * @param utcDate UTC time
 * @returns China time string
 */
export function utcToChinaTime(utcDate: Date | string): string {
  const d = typeof utcDate === 'string' ? new Date(utcDate) : utcDate;
  return formatChinaTime(d);
}

/**
 * get China timestamp (milliseconds)
 * @returns China time timestamp
 */
export function getChinaTimestamp(): number {
  return getChinaTime().getTime();
}

