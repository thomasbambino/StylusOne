import { useState, useEffect, useRef, ImgHTMLAttributes } from 'react';
import { getCachedImage, cacheImage } from '@/lib/imageCache';
import { isNativePlatform } from '@/lib/capacitor';

interface CachedImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src: string | null | undefined;
  fallback?: React.ReactNode;
}

/**
 * Image component with caching support for native apps
 * Falls back to regular img tag on web
 */
export function CachedImage({ src, fallback, alt, ...props }: CachedImageProps) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadImage() {
      if (!src) {
        setLoading(false);
        setError(true);
        return;
      }

      // On web, just use the URL directly
      if (!isNativePlatform()) {
        setImageSrc(src);
        setLoading(false);
        return;
      }

      try {
        // Check cache first
        const cached = await getCachedImage(src);
        if (cached && mounted) {
          blobUrlRef.current = cached;
          setImageSrc(cached);
          setLoading(false);
          return;
        }

        // Try to cache the image
        const cachedUrl = await cacheImage(src);
        if (mounted) {
          if (cachedUrl) {
            blobUrlRef.current = cachedUrl;
            setImageSrc(cachedUrl);
          } else {
            // Fallback to original URL if caching fails
            setImageSrc(src);
          }
          setLoading(false);
        }
      } catch (err) {
        if (mounted) {
          // Fallback to original URL on error
          setImageSrc(src);
          setLoading(false);
        }
      }
    }

    setLoading(true);
    setError(false);
    loadImage();

    return () => {
      mounted = false;
      // Revoke blob URL to free memory
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [src]);

  const handleError = () => {
    setError(true);
    // If cached version failed, try original URL
    if (blobUrlRef.current && src) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
      setImageSrc(src);
    }
  };

  if (loading) {
    return fallback ? <>{fallback}</> : null;
  }

  if (error || !imageSrc) {
    return fallback ? <>{fallback}</> : null;
  }

  return (
    <img
      {...props}
      src={imageSrc}
      alt={alt}
      onError={handleError}
    />
  );
}
