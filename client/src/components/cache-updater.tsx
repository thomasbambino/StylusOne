import { useEffect, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';

export function CacheUpdater() {
  const { toast } = useToast();
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    // Listen for messages from service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data.type === 'CACHE_UPDATED') {
          console.log('[CacheUpdater] Received update notification:', event.data.version);
          
          // Auto-refresh after a short delay to show the toast
          toast({
            title: "Update Available",
            description: "New version installed! Refreshing in 3 seconds...",
            action: (
              <Button 
                size="sm" 
                onClick={() => window.location.reload()}
              >
                Refresh Now
              </Button>
            ),
          });
          
          setTimeout(() => {
            window.location.reload();
          }, 3000);
        }
      });

      // Check for service worker updates periodically
      const checkForUpdates = async () => {
        if (navigator.serviceWorker.controller) {
          const reg = await navigator.serviceWorker.ready;
          setRegistration(reg);
          
          // Check for updates every 30 minutes
          setInterval(() => {
            reg.update();
          }, 30 * 60 * 1000);
          
          // Also check on visibility change (when tab becomes active)
          document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
              reg.update();
            }
          });
        }
      };
      
      checkForUpdates();

      // Listen for new service worker waiting
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        console.log('[CacheUpdater] New service worker activated');
      });
    }
  }, [toast]);

  // Manual update button (optional - can be shown in settings)
  const handleManualUpdate = () => {
    if (registration) {
      registration.update().then(() => {
        toast({
          title: "Checking for updates...",
          description: "If an update is available, the page will refresh automatically.",
        });
      });
    }
  };

  // You can optionally show a manual update button in development
  if (process.env.NODE_ENV === 'development' && updateAvailable) {
    return (
      <div className="fixed bottom-20 right-4 z-50">
        <Button
          onClick={handleManualUpdate}
          size="sm"
          className="shadow-lg"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Update Available
        </Button>
      </div>
    );
  }

  return null;
}