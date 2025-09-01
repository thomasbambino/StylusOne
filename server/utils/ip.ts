async function getIpInfo(ip: string) {
  console.log('Getting IP info for:', ip);
  try {
    // Use the free IP-API endpoint
    const response = await fetch(`http://ip-api.com/json/${ip}`);
    const data = await response.json();

    console.log('Received IP info:', data);

    // Check for error responses
    if (data.status === 'fail') {
      console.error('ip-api.com error:', data.message);
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
    console.error('Failed to get IP info:', error);
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