import axios from 'axios';
import https from 'https';
import { loggers } from './lib/logger';

interface AMPInstance {
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

export class AMPService {
  private baseUrl: string;
  private username: string;
  private password: string;
  private sessionId: string | null = null;
  private sessionExpiry: Date | null = null;

  constructor() {
    this.baseUrl = (process.env.AMP_API_URL || '').replace(/\/$/, '');
    this.username = process.env.AMP_API_USERNAME || '';
    this.password = process.env.AMP_API_PASSWORD || '';

    if (!this.baseUrl || !this.username || !this.password) {
      loggers.amp.error('AMP configuration missing', {
        hasUrl: !!this.baseUrl,
        hasUsername: !!this.username,
        hasPassword: !!this.password
      });
    }

    axios.defaults.httpsAgent = new https.Agent({
      rejectUnauthorized: false
    });
  }

  private async makeAPICall(endpoint: string, parameters: any = {}, requiresAuth: boolean = true) {
    try {
      loggers.amp.debug(`Making API call to ${endpoint}`, { ...parameters, password: '[REDACTED]' });

      const response = await axios.post(
        `${this.baseUrl}/API/${endpoint}`,
        {
          ...parameters,
          ...(requiresAuth && this.sessionId ? { SESSIONID: this.sessionId } : {})
        },
        {
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          }
        }
      );

      loggers.amp.debug(`API Response from ${endpoint}`, { data: response.data });
      return response.data;
    } catch (error) {
      loggers.amp.error(`API call failed for ${endpoint}`, { error });
      if (axios.isAxiosError(error) && error.response) {
        loggers.amp.error('Error response', { data: error.response.data });
        throw new Error(`API call failed: ${error.response.data.message || error.message}`);
      }
      throw error;
    }
  }

  private async login(): Promise<void> {
    try {
      loggers.amp.info('Attempting to login to AMP');
      const loginData = {
        username: this.username,
        password: this.password,
        token: '',
        rememberMe: false
      };

      const response = await this.makeAPICall('Core/Login', loginData, false);
      if (response.sessionID) {
        this.sessionId = response.sessionID;
        this.sessionExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
        loggers.amp.info('Login successful, session established');
      } else {
        throw new Error('No session ID in login response');
      }
    } catch (error) {
      loggers.amp.error('Login failed', { error });
      throw error;
    }
  }

  private async ensureAuthenticated(): Promise<void> {
    if (!this.sessionId || !this.sessionExpiry || new Date() > this.sessionExpiry) {
      await this.login();
    }
  }

  private async callAPI(endpoint: string, parameters: any = {}): Promise<any> {
    await this.ensureAuthenticated();
    return this.makeAPICall(endpoint, parameters, true);
  }

  // Server control methods
  async startInstance(instanceId: string): Promise<void> {
    await this.callAPI(`ADSModule/Servers/${instanceId}/API/Core/Start`, {});
  }

  async stopInstance(instanceId: string): Promise<void> {
    await this.callAPI(`ADSModule/Servers/${instanceId}/API/Core/Stop`, {});
  }

  async restartInstance(instanceId: string): Promise<void> {
    await this.callAPI(`ADSModule/Servers/${instanceId}/API/Core/Restart`, {});
  }

  async killInstance(instanceId: string): Promise<void> {
    await this.callAPI(`ADSModule/Servers/${instanceId}/API/Core/Kill`, {});
  }

  // Status and metrics methods
  async getInstances(): Promise<AMPInstance[]> {
    try {
      loggers.amp.debug('Fetching AMP instances');
      const result = await this.callAPI('ADSModule/GetInstances', {});

      if (result && Array.isArray(result) && result.length > 0 && result[0].AvailableInstances) {
        const instances = result[0].AvailableInstances;
        loggers.amp.debug('Found instances with metrics', { instances });
        return instances.map((instance: any) => ({
          ...instance,
          Metrics: instance.Metrics || {
            'CPU Usage': { RawValue: 0, MaxValue: 100 },
            'Memory Usage': { RawValue: 0, MaxValue: 0 },
            'Active Users': { RawValue: 0, MaxValue: 0 }
          }
        }));
      }
      loggers.amp.debug('No instances found in response');
      return [];
    } catch (error) {
      loggers.amp.error('Failed to fetch instances', { error });
      throw error;
    }
  }

  async getInstanceStatus(instanceId: string): Promise<any> {
    try {
      loggers.amp.debug(`Getting status for instance ${instanceId}`);
      const status = await this.callAPI(`ADSModule/Servers/${instanceId}/API/Core/GetStatus`, {});
      loggers.amp.debug(`Status for instance ${instanceId}`, { status });
      return status;
    } catch (error) {
      loggers.amp.error(`Failed to get status for instance ${instanceId}`, { error });
      throw error;
    }
  }

  async getMetrics(instanceId: string): Promise<{
    TPS: string;
    Users: [string, string];
    CPU: string;
    Memory: [string, string];
    Uptime: string;
  }> {
    try {
      loggers.amp.debug(`Getting metrics for instance ${instanceId}`);
      const result = await this.getInstanceStatus(instanceId);
      loggers.amp.debug('Raw metrics result', { result });

      // Extract metrics with proper null/undefined checking
      const metrics = {
        TPS: String(result.State || '0'),
        Users: [
          String(result.Metrics?.['Active Users']?.RawValue || '0'),
          String(result.Metrics?.['Active Users']?.MaxValue || '0')
        ] as [string, string],
        CPU: String(result.Metrics?.['CPU Usage']?.RawValue || '0'),
        Memory: [
          String(result.Metrics?.['Memory Usage']?.RawValue || '0'),
          String(result.Metrics?.['Memory Usage']?.MaxValue || '0')
        ] as [string, string],
        Uptime: String(result.Uptime || '00:00:00')
      };

      loggers.amp.debug('Formatted metrics', { metrics });
      return metrics;
    } catch (error) {
      loggers.amp.error(`Failed to get metrics for instance ${instanceId}`, { error });
      // Return default values in case of error
      return {
        TPS: '0',
        Users: ['0', '0'] as [string, string],
        CPU: '0',
        Memory: ['0', '0'] as [string, string],
        Uptime: '00:00:00'
      };
    }
  }

  async getUserList(instanceId: string): Promise<string[]> {
    try {
      loggers.amp.debug(`Getting user list for instance ${instanceId}`);

      // Call the GetUserList API endpoint
      const result = await this.callAPI(`ADSModule/Servers/${instanceId}/API/Core/GetUserList`, {});
      loggers.amp.debug('Raw user list response', { result });

      // Handle empty or invalid responses
      if (!result || typeof result !== 'object') {
        loggers.amp.debug(`No valid user list returned for instance ${instanceId}`);
        return [];
      }

      // Extract the values into an array
      const userList: string[] = [];
      for (const key in result) {
        if (Object.prototype.hasOwnProperty.call(result, key)) {
          userList.push(result[key]);
        }
      }

      loggers.amp.debug(`Found ${userList.length} active players`, { userList });
      return userList;
    } catch (error) {
      loggers.amp.error(`Failed to get user list for instance ${instanceId}`, { error });
      return [];
    }
  }

  async getActivePlayerCount(instanceId: string): Promise<number> {
    try {
      // Try getting count from user list first
      const userList = await this.getUserList(instanceId);
      if (userList.length > 0) {
        return userList.length;
      }

      // Fall back to metrics if user list is empty
      const metrics = await this.getMetrics(instanceId);
      return parseInt(metrics.Users[0]) || 0;
    } catch (error) {
      loggers.amp.error(`Failed to get active player count for instance ${instanceId}`, { error });
      return 0;
    }
  }

  async debugPlayerCount(instanceId: string): Promise<void> {
    try {
      loggers.amp.debug(`Debug Player Count for Instance ${instanceId}`);

      // Method 1: Get count from metrics
      loggers.amp.debug('1. Getting count from metrics');
      const metrics = await this.getMetrics(instanceId);
      loggers.amp.debug('Raw metrics response', { metrics });
      loggers.amp.debug('Users from metrics', { users: metrics.Users });
      const metricsCount = parseInt(metrics.Users[0]) || 0;
      loggers.amp.debug('Parsed metrics count', { metricsCount });

      // Method 2: Get count from user list
      loggers.amp.debug('2. Getting count from user list');
      const userList = await this.getUserList(instanceId);
      loggers.amp.debug('Raw user list', { userList });
      loggers.amp.debug('User list count', { count: userList.length });

      // Get full instance status for comparison
      loggers.amp.debug('3. Getting full instance status');
      const status = await this.getInstanceStatus(instanceId);
      loggers.amp.debug('Full instance status', { status });

    } catch (error) {
      loggers.amp.error('Debug operation failed', { error });
    }
  }

  async getAvailableAPIMethods(): Promise<any> {
    try {
      loggers.amp.debug('Attempting to get API specification');
      // Try to get the API specification
      const apiSpec = await this.callAPI('Core/GetAPISpec', {});
      loggers.amp.debug('Available API methods', { apiSpec });
      return apiSpec;
    } catch (error) {
      loggers.amp.error('Failed to get API specification', { error });

      // If GetAPISpec also doesn't exist, try a different approach
      try {
        loggers.amp.debug('Trying to get module info instead');
        const moduleInfo = await this.callAPI('Core/GetModuleInfo', {});
        loggers.amp.debug('Module info (might contain API hints)', { moduleInfo });
        return moduleInfo;
      } catch (innerError) {
        loggers.amp.error('Also failed to get module info', { error: innerError });
        throw new Error('Cannot determine available API methods');
      }
    }
  }
}

export const ampService = new AMPService();