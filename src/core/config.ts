/**
 * Configuration management for HacknPlan-Obsidian Glue
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import type { Pairing, GlueConfig } from './types.js';

/**
 * Get the config file path from environment or arguments
 */
export function getConfigPath(): string {
  return (
    process.env.GLUE_CONFIG_PATH ||
    process.argv.find((arg) => arg.startsWith('--config='))?.split('=')[1] ||
    join(process.cwd(), 'glue-config.json')
  );
}

/**
 * Load pairings from config file
 */
export function loadConfig(configPath: string): Pairing[] {
  try {
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, 'utf-8')) as GlueConfig;
      console.error(`[glue] Loaded ${config.pairings?.length || 0} pairings from ${configPath}`);
      return config.pairings || [];
    } else {
      console.error(`[glue] No config file at ${configPath}, starting fresh`);
      return [];
    }
  } catch (e) {
    console.error(`[glue] Failed to load config: ${(e as Error).message}`);
    return [];
  }
}

/**
 * Save pairings to config file
 */
export function saveConfig(configPath: string, pairings: Pairing[]): void {
  try {
    const dir = dirname(configPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const config: GlueConfig = {
      pairings,
      version: '2.0.0',
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.error(`[glue] Saved config to ${configPath}`);
  } catch (e) {
    console.error(`[glue] Failed to save config: ${(e as Error).message}`);
  }
}

/**
 * Create a pairing manager with CRUD operations
 */
export function createPairingManager(configPath: string) {
  let pairings: Pairing[] = loadConfig(configPath);

  return {
    /**
     * Get pairing by project ID
     */
    getPairing(projectId: number): Pairing | undefined {
      return pairings.find((p) => p.projectId === projectId);
    },

    /**
     * Get pairing by vault path
     */
    getPairingByVault(vaultPath: string): Pairing | undefined {
      return pairings.find((p) => vaultPath.startsWith(p.vaultPath));
    },

    /**
     * Get all pairings
     */
    getAllPairings(): Pairing[] {
      return [...pairings];
    },

    /**
     * Add or replace a pairing
     */
    addPairing(pairing: Pairing): void {
      // Remove existing pairing for same project
      pairings = pairings.filter((p) => p.projectId !== pairing.projectId);
      pairings.push(pairing);
    },

    /**
     * Remove a pairing by project ID
     */
    removePairing(projectId: number): boolean {
      const before = pairings.length;
      pairings = pairings.filter((p) => p.projectId !== projectId);
      return before > pairings.length;
    },

    /**
     * Update an existing pairing
     */
    updatePairing(projectId: number, updates: Partial<Pairing>): Pairing | null {
      const pairing = pairings.find((p) => p.projectId === projectId);
      if (!pairing) return null;

      if (updates.folderMappings) pairing.folderMappings = updates.folderMappings;
      if (updates.tagMappings) pairing.tagMappings = updates.tagMappings;
      if (updates.defaultBoard !== undefined) pairing.defaultBoard = updates.defaultBoard;
      pairing.updatedAt = new Date().toISOString();

      return pairing;
    },

    /**
     * Save config to disk
     */
    saveConfig(): void {
      saveConfig(configPath, pairings);
    },

    /**
     * Reload config from disk
     */
    reloadConfig(): void {
      pairings = loadConfig(configPath);
    },
  };
}

export type PairingManager = ReturnType<typeof createPairingManager>;
