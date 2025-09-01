import { IService } from './interfaces';
import axios from 'axios';

/**
 * Interface for AMP instance information
 */
export interface AMPInstance {
  InstanceID: string;
  FriendlyName: string;
  Running: boolean;
  Status: string;
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
}

/**
 * Service for interacting with AMP (Application Management Platform) game server management
 */
export class AMPService implements IService {
  private baseUrl: string;
  private username: string;
  private password: string;
  private sessionId: string | null = null;
  private sessionExpiry: Date | null = null;
  private initialized: boolean = false;

  constructor() {
    this.baseUrl = process.env.AMP_API_URL || '';
    this.username = process.env.AMP_API_USERNAME || '';
    this.password = process.env.AMP_API_PASSWORD || '';
  }

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.baseUrl && this.username && this.password) {
      try {
        await this.login();
        this.initialized = true;
        console.log('AMP Service initialized successfully');
      } catch (error) {
        console.error('Failed to initialize AMP Service:', error);
        console.warn('AMP Service will continue to work in degraded mode');
        // Don't throw error to prevent blocking other services
      }
    } else {
      console.warn('AMP Service not fully configured - missing credentials');
    }
  }

  /**
   * Reinitialize the service with new configuration
   */
  async reinitialize(baseUrl?: string, username?: string, password?: string): Promise<void> {
    if (baseUrl) this.baseUrl = baseUrl;
    if (username) this.username = username;
    if (password) this.password = password;
    
    this.sessionId = null;
    this.sessionExpiry = null;
    
    await this.initialize();
  }

  /**
   * Check if the service is healthy
   */
  async isHealthy(): Promise<boolean> {
    try {
      await this.ensureAuthenticated();
      return true;
    } catch (error) {
      console.error('AMP Service health check failed:', error);
      return false;
    }
  }

  /**
   * Make an API call to the AMP server
   */
  private async makeAPICall(endpoint: string, parameters: any = {}, requiresAuth: boolean = true) {
    const url = `${this.baseUrl}/${endpoint}`;
    
    const requestData = {
      SESSIONID: requiresAuth ? this.sessionId : null,
      ...parameters
    };

    try {
      const response = await axios.post(url, requestData, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        timeout: 10000 // 10 second timeout
      });

      if (response.status !== 200) {
        throw new Error(`API call failed with status ${response.status}`);
      }

      const data = response.data;
      
      // Handle AMP API response format - check for success field
      if (data.success === false) {
        throw new Error(`API returned error: ${data.resultReason || 'Unknown error'}`);
      }
      
      // For login endpoint, return the full response (contains sessionID, etc.)
      if (data.sessionID) {
        return data;
      }
      
      // For other endpoints, return the result if it exists
      return data.result !== undefined ? data.result : data;
    } catch (error) {
      // Don't log the full error which might contain credentials
      console.error(`Error calling AMP API at ${endpoint}:`, error.message || 'Connection failed');
      throw error;
    }
  }

  /**
   * Log in to the AMP server
   */
  private async login(): Promise<void> {
    try {
      const result = await this.makeAPICall('Core/Login', {
        username: this.username,
        password: this.password,
        rememberMe: true,
        token: ''
      }, false);

      this.sessionId = result.sessionID;
      
      // Set session expiry to 1 hour from now
      this.sessionExpiry = new Date();
      this.sessionExpiry.setHours(this.sessionExpiry.getHours() + 1);
      
      console.log('Successfully logged in to AMP');
    } catch (error) {
      console.error('Failed to login to AMP:', error.message || 'Authentication failed');
      throw error;
    }
  }

  /**
   * Ensure the service is authenticated
   */
  private async ensureAuthenticated(): Promise<void> {
    if (!this.sessionId || !this.sessionExpiry || new Date() > this.sessionExpiry) {
      await this.login();
    }
  }

  /**
   * Call the AMP API
   */
  private async callAPI(endpoint: string, parameters: any = {}): Promise<any> {
    await this.ensureAuthenticated();
    return this.makeAPICall(endpoint, parameters, true);
  }

  /**
   * Start an AMP instance
   */
  async startInstance(instanceId: string): Promise<void> {
    console.log(`AMP Service: Starting instance ${instanceId}`);
    try {
      // Try multiple possible AMP API endpoints for starting instances
      let result;
      
      // First try the ADSModule endpoint (for AMP controller)
      try {
        result = await this.callAPI(`ADSModule/StartInstance`, { InstanceName: instanceId });
        console.log(`AMP Service: Start result via ADSModule/StartInstance for ${instanceId}:`, result);
      } catch (adsError) {
        console.log(`ADSModule/StartInstance failed, trying direct Core/Start: ${adsError.message}`);
        
        // Try direct Core API call
        try {
          result = await this.callAPI(`Core/Start`, {});
          console.log(`AMP Service: Start result via Core/Start for ${instanceId}:`, result);
        } catch (coreError) {
          console.log(`Core/Start failed, trying instance-specific endpoint: ${coreError.message}`);
          
          // Try the original endpoint format
          result = await this.callAPI(`ADSModule/Servers/${instanceId}/API/Core/Start`, {});
          console.log(`AMP Service: Start result via ADSModule/Servers endpoint for ${instanceId}:`, result);
        }
      }
    } catch (error) {
      console.error(`AMP Service: All start methods failed for ${instanceId}:`, error);
      throw error;
    }
  }

  /**
   * Stop an AMP instance
   */
  async stopInstance(instanceId: string): Promise<void> {
    console.log(`AMP Service: Stopping instance ${instanceId}`);
    try {
      // Try multiple possible AMP API endpoints for stopping instances
      let result;
      
      // First try the ADSModule endpoint (for AMP controller)
      try {
        result = await this.callAPI(`ADSModule/StopInstance`, { InstanceName: instanceId });
        console.log(`AMP Service: Stop result via ADSModule/StopInstance for ${instanceId}:`, result);
      } catch (adsError) {
        console.log(`ADSModule/StopInstance failed, trying direct Core/Stop: ${adsError.message}`);
        
        // Try direct Core API call
        try {
          result = await this.callAPI(`Core/Stop`, {});
          console.log(`AMP Service: Stop result via Core/Stop for ${instanceId}:`, result);
        } catch (coreError) {
          console.log(`Core/Stop failed, trying instance-specific endpoint: ${coreError.message}`);
          
          // Try the original endpoint format
          result = await this.callAPI(`ADSModule/Servers/${instanceId}/API/Core/Stop`, {});
          console.log(`AMP Service: Stop result via ADSModule/Servers endpoint for ${instanceId}:`, result);
        }
      }
    } catch (error) {
      console.error(`AMP Service: All stop methods failed for ${instanceId}:`, error);
      throw error;
    }
  }

  /**
   * Restart an AMP instance
   */
  async restartInstance(instanceId: string): Promise<void> {
    await this.callAPI(`ADSModule/Servers/${instanceId}/API/Core/Restart`, {});
  }

  /**
   * Kill an AMP instance
   */
  async killInstance(instanceId: string): Promise<void> {
    await this.callAPI(`ADSModule/Servers/${instanceId}/API/Core/Kill`, {});
  }

  /**
   * Get all AMP instances
   */
  async getInstances(): Promise<AMPInstance[]> {
    try {
      console.log('Fetching AMP instances');
      const result = await this.callAPI('ADSModule/GetInstances', {});
      
      console.log('Raw AMP instances:', result);
      
      if (!Array.isArray(result)) {
        console.error('Expected array of instances but got:', result);
        return [];
      }
      
      // Check if the result contains AvailableInstances (AMP controller structure)
      let instances: AMPInstance[] = [];
      
      if (result.length > 0 && result[0].AvailableInstances) {
        // This is an AMP controller response with nested instances
        console.log('Detected AMP controller structure with AvailableInstances');
        instances = result[0].AvailableInstances;
        console.log(`Found ${instances.length} available instances in controller`);
      } else if (result.length > 0 && result[0].InstanceID) {
        // This is a direct array of instances
        console.log('Detected direct array of instances');
        instances = result;
      } else {
        console.error('Unrecognized AMP response structure:', result);
        return [];
      }
      
      console.log(`Retrieved ${instances.length} AMP instances`);
      console.log('Instance summary:', instances.map(i => ({
        id: i.InstanceID,
        name: i.FriendlyName,
        running: i.Running,
        module: i.Module || i.ModuleDisplayName
      })));
      
      return instances;
    } catch (error) {
      console.error('Error getting AMP instances:', error);
      return [];
    }
  }

  /**
   * Get status of a specific instance
   */
  async getInstanceStatus(instanceId: string): Promise<any> {
    return await this.callAPI(`ADSModule/Servers/${instanceId}/API/Core/GetStatus`, {});
  }

  /**
   * Get metrics for a specific instance
   */
  async getMetrics(instanceId: string): Promise<{
    cpu: number;
    memory: number;
    activePlayers: number;
    maxPlayers: number;
  }> {
    try {
      const status = await this.getInstanceStatus(instanceId);
      
      // Extract the metrics
      const cpu = status.Metrics?.['CPU Usage']?.RawValue || 0;
      const memory = status.Metrics?.['Memory Usage']?.RawValue || 0;
      const activePlayers = status.Metrics?.['Active Users']?.RawValue || 0;
      const maxPlayers = status.Metrics?.['Active Users']?.MaxValue || 0;
      
      return {
        cpu,
        memory,
        activePlayers,
        maxPlayers
      };
    } catch (error) {
      console.error(`Error getting metrics for instance ${instanceId}:`, error);
      return {
        cpu: 0,
        memory: 0,
        activePlayers: 0,
        maxPlayers: 0
      };
    }
  }

  /**
   * Get user list for a specific instance
   */
  async getUserList(instanceId: string): Promise<string[]> {
    try {
      const result = await this.callAPI(`ADSModule/Servers/${instanceId}/API/Core/GetUserList`, {});
      
      if (!Array.isArray(result)) {
        console.warn(`Expected array of users for instance ${instanceId} but got:`, result);
        return [];
      }
      
      return result;
    } catch (error) {
      console.error(`Error getting user list for instance ${instanceId}:`, error);
      return [];
    }
  }

  /**
   * Get active player count for a specific instance
   */
  async getActivePlayerCount(instanceId: string): Promise<number> {
    try {
      const users = await this.getUserList(instanceId);
      return users.length;
    } catch (error) {
      console.error(`Error getting active player count for instance ${instanceId}:`, error);
      return 0;
    }
  }

  /**
   * Debug player count issues for a specific instance
   */
  async debugPlayerCount(instanceId: string): Promise<void> {
    try {
      console.log(`DEBUG: Getting status for instance ${instanceId}`);
      const status = await this.getInstanceStatus(instanceId);
      console.log('Status:', JSON.stringify(status, null, 2));
      
      console.log(`DEBUG: Getting user list for instance ${instanceId}`);
      const users = await this.getUserList(instanceId);
      console.log('Users:', users);
      
      console.log(`DEBUG: Getting metrics for instance ${instanceId}`);
      const metrics = await this.getMetrics(instanceId);
      console.log('Metrics:', metrics);
    } catch (error) {
      console.error(`Error during player count debugging for instance ${instanceId}:`, error);
    }
  }

  /**
   * Get system information
   */
  async getSystemInfo(): Promise<any> {
    return await this.callAPI('Core/GetSystemInfo', {});
  }

  /**
   * Get available API methods
   */
  async getAvailableAPIMethods(): Promise<any> {
    try {
      const result = await this.callAPI('Core/GetAPISpec', {});
      return result;
    } catch (error) {
      console.error('Error getting API spec:', error);
      
      try {
        console.log('Trying GetAPISpecification instead...');
        const result = await this.callAPI('Core/GetAPISpecification', {});
        return result;
      } catch (innerError) {
        console.error('Also failed to get API specification:', innerError);
        
        // If GetAPISpec also doesn't exist, try a different approach
        try {
          console.log('Trying to get module info instead...');
          const moduleInfo = await this.callAPI('Core/GetModuleInfo', {});
          console.log('Module info (might contain API hints):', moduleInfo);
          return moduleInfo;
        } catch (innerError) {
          console.error('Also failed to get module info:', innerError);
          throw new Error('Cannot determine available API methods');
        }
      }
    }
  }
}

// Export a singleton instance
export const ampService = new AMPService();