import { useState, useEffect } from 'react';
import { isNativePlatform } from '@/lib/capacitor';
import { CapacitorHttp } from '@capacitor/core';

interface AuthenticatedImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src: string | null | undefined;
  alt: string;
}

/**
 * Image component that handles authenticated image loading on native platforms.
 * On web platforms, uses regular img tag. On native platforms, fetches image
 * via CapacitorHttp with authentication and creates a blob URL.
 */
export function AuthenticatedImage({ src, alt, onError, ...props }: AuthenticatedImageProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!src) {
      setBlobUrl(null);
      return;
    }

    // On web platforms, just use the src directly
    if (!isNativePlatform()) {
      setBlobUrl(src);
      return;
    }

    // On native platforms, fetch via CapacitorHttp and create blob URL
    let cancelled = false;

    async function fetchImage() {
      try {
        // Use CapacitorHttp.get which automatically handles authentication via cookies
        const response = await CapacitorHttp.get({
          url: src!,
          responseType: 'arraybuffer',
        });

        if (cancelled) return;

        if (response.status !== 200) {
          throw new Error(`HTTP ${response.status}`);
        }

        // CapacitorHttp returns base64-encoded data for arraybuffer type
        const base64Data = response.data;
        const contentType = response.headers['Content-Type'] || response.headers['content-type'] || 'image/jpeg';

        // Convert base64 to blob
        const byteCharacters = atob(base64Data);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: contentType });

        const url = URL.createObjectURL(blob);
        setBlobUrl(url);
      } catch {
        // Image load failure - showing fallback
        if (!cancelled) {
          setError(true);
          if (onError) {
            const event = new Event('error') as any;
            onError(event);
          }
        }
      }
    }

    fetchImage();

    // Cleanup function
    return () => {
      cancelled = true;
      if (blobUrl && isNativePlatform()) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [src]);

  if (!src || error) {
    return null;
  }

  return (
    <img
      {...props}
      src={blobUrl || undefined}
      alt={alt}
      onError={(e) => {
        setError(true);
        if (onError) onError(e);
      }}
    />
  );
}
