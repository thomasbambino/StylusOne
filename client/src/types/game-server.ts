import { GameServer } from "@shared/schema";

/**
 * Extended GameServer interface that includes runtime properties from the AMP API
 * These properties are not stored in the database but are provided at runtime
 */
export interface GameServerWithRuntime extends GameServer {
  // Runtime properties from AMP API
  version?: string;
  ip?: string;
  port?: string | number;
  players?: string[];
  cpuUsage?: number;
  memoryUsage?: number;
  maxMemory?: number;
  allocatedMemory?: number;

  // Custom display properties (may be stored or runtime)
  customName?: string;
  customType?: string;
  customIcon?: string;
}

/**
 * AMP Instance interface matching the server response structure
 */
export interface AMPInstance {
  InstanceID: string;
  FriendlyName: string;
  Running: boolean;
  Status: string;
  State?: string;
  Metrics: {
    'CPU Usage': {
      RawValue: number;
      MaxValue: number;
    };
    'Memory Usage': {
      RawValue: number;
      MaxValue: number;
    };
    'Active Users': {
      RawValue: number;
      MaxValue: number;
    };
  };
  ApplicationEndpoints?: Array<{
    DisplayName: string;
    Endpoint: string;
  }>;
  // Additional AMP API properties
  Module?: string;
  ModuleDisplayName?: string;
  InstanceName?: string;
  IP?: string;
  Port?: number;
  Version?: string;
  Uptime?: number;
  ConnectionString?: string;
  ApplicationName?: string;

  // Processed/mapped properties (lowercase) that might be added by the API
  type?: string;
  instanceId?: string;
  hidden?: boolean;
  show_player_count?: boolean;
  AppState?: number;
  name?: string;
  status?: boolean;
  playerCount?: number;
  maxPlayers?: number;
}

/**
 * Metrics response from the game server metrics endpoint
 */
export interface GameServerMetrics {
  cpu: number;
  memory: number;
  activePlayers?: number;
  maxPlayers?: number;
  debug?: {
    rawMetrics?: {
      'Memory Usage'?: {
        MaxValue: number;
      };
    };
    applicationName?: string;
    state?: string;
    running?: boolean;
    uptime?: string;
    fullInstance?: {
      ApplicationEndpoints?: Array<{
        DisplayName: string;
        Endpoint: string;
      }>;
    };
  };
}
