import { loggers } from '../lib/logger';

async function getIpInfo(ip: string) {
  loggers.api.debug('Getting IP info', { ip });
  try {
    // Use the free IP-API endpoint
    const response = await fetch(`http://ip-api.com/json/${ip}`);
    const data = await response.json();

    loggers.api.debug('Received IP info', { data });

    // Check for error responses
    if (data.status === 'fail') {
      loggers.api.error('ip-api.com error', { message: data.message });
      return {
        ip,
        isp: null,
        city: null,
        region: null,
        country: null,
      };
    }

    return {
      ip,
      isp: data.isp || data.org || null,
      city: data.city || null,
      region: data.regionName || null,
      country: data.country || null,
    };
  } catch (error) {
    loggers.api.error('Failed to get IP info', { error });
    return {
      ip,
      isp: null,
      city: null,
      region: null,
      country: null,
    };
  }
}

export { getIpInfo };