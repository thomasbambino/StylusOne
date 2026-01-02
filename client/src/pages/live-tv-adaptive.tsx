import { useEffect, useState } from 'react';
import { getDeviceType, type DeviceType } from '@/lib/capacitor';
import LiveTVTV from './live-tv-tv';
import LiveTVPage from './live-tv-page'; // Fallback for web

/**
 * Adaptive Live TV component that switches layouts based on device type
 * - Phone/Tablet/TV: Unified TV-style interface with overlay controls and guide
 * - Web: Full-featured desktop layout
 */
export default function LiveTVAdaptive() {
  const [deviceType, setDeviceType] = useState<DeviceType>('web');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function detectDevice() {
      const type = await getDeviceType();
      setDeviceType(type);
      setIsLoading(false);
      console.log(`[Live TV] Detected device type: ${type}`);
    }

    detectDevice();
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center">
          <div className="text-lg">Loading...</div>
        </div>
      </div>
    );
  }

  // Select the appropriate layout based on device type
  switch (deviceType) {
    case 'tv':
    case 'tablet':
    case 'phone':
      return <LiveTVTV />;
    case 'web':
    default:
      return <LiveTVPage />;
  }
}
