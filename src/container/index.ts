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
 * Container Factory
 *
 * Central module for creating and managing the dependency injection container.
 *
 * @example Basic usage
 * ```typescript
 * import { createContainer } from './container';
 *
 * const container = createContainer();
 *
 * // Access dependencies
 * const balance = await container.exchangeClient.getFuturesAccount();
 * const logger = container.logger;
 * ```
 *
 * @example Testing with mocks
 * ```typescript
 * import { createContainer } from './container';
 *
 * const testContainer = createContainer({
 *   exchangeClient: mockExchangeClient,
 *   database: mockDatabase
 * });
 * ```
 */

import { Container } from './base';
import type { AppContainer, ContainerOptions } from '../types/container';

/**
 * Singleton container instance
 */
let containerInstance: Container | null = null;

/**
 * Create or get the application container
 *
 * By default, returns a singleton instance. Pass `singleton: false`
 * in options to create a new instance each time.
 *
 * @param options - Container configuration options
 * @returns AppContainer instance
 *
 * @example
 * ```typescript
 * // Get singleton instance
 * const container = createContainer();
 *
 * // Create new instance for testing
 * const testContainer = createContainer({ singleton: false });
 * ```
 */
export function createContainer(
  options?: ContainerOptions & { singleton?: boolean }
): AppContainer {
  const useSingleton = options?.singleton ?? true;

  // Return existing singleton if requested
  if (useSingleton && containerInstance) {
    return containerInstance;
  }

  // Create new container
  const container = new Container(options);

  // Store as singleton if requested
  if (useSingleton) {
    containerInstance = container;
  }

  return container;
}

/**
 * Get the singleton container instance
 *
 * Throws an error if container hasn't been created yet.
 * Use createContainer() to initialize.
 *
 * @returns AppContainer instance
 * @throws Error if container not initialized
 */
export function getContainer(): AppContainer {
  if (!containerInstance) {
    throw new Error(
      'Container not initialized. Call createContainer() first.'
    );
  }
  return containerInstance;
}

/**
 * Check if container is initialized
 */
export function hasContainer(): boolean {
  return containerInstance !== null;
}

/**
 * Reset the container singleton
 *
 * Disposes of the current container and clears the singleton.
 * Useful for testing or reconfiguring the system.
 */
export async function resetContainer(): Promise<void> {
  if (containerInstance) {
    await containerInstance.dispose();
    containerInstance = null;
  }
}

/**
 * Dispose of the container and clean up resources
 *
 * Should be called when shutting down the application.
 * Closes database connections and other resources.
 */
export async function disposeContainer(): Promise<void> {
  if (containerInstance) {
    await containerInstance.dispose();
  }
}

// Re-export types and classes
export { Container } from './base';
export type { AppContainer, ContainerOptions, PartialContainer } from '../types/container';
