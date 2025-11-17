import React from 'react';
import { Button } from "@/components/ui/button";
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';

// Declare Google Identity Services types
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: any) => void;
          prompt: () => void;
          renderButton: (parent: HTMLElement, options: any) => void;
        };
      };
    };
  }
}

export function GoogleAuthButton() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = React.useState(false);
  const [isGoogleLoaded, setIsGoogleLoaded] = React.useState(false);
  const buttonRef = React.useRef<HTMLDivElement>(null);

  // Load Google Identity Services library
  React.useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      console.log('[Google Auth] Google Identity Services loaded');
      setIsGoogleLoaded(true);
    };
    script.onerror = () => {
      console.error('[Google Auth] Failed to load Google Identity Services');
      toast({
        title: "Error",
        description: "Failed to load Google Sign-In. Please refresh the page.",
        variant: "destructive",
      });
    };
    document.head.appendChild(script);

    return () => {
      document.head.removeChild(script);
    };
  }, [toast]);

  // Initialize Google Sign-In when library is loaded
  React.useEffect(() => {
    if (!isGoogleLoaded || !window.google || !buttonRef.current) {
      return;
    }

    try {
      console.log('[Google Auth] Initializing Google Identity Services');

      const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

      if (!clientId) {
        console.error('[Google Auth] VITE_GOOGLE_CLIENT_ID is not set');
        toast({
          title: "Configuration Error",
          description: "Google Sign-In is not properly configured. Please contact the administrator.",
          variant: "destructive",
        });
        return;
      }

      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: handleCredentialResponse,
        auto_select: false,
        cancel_on_tap_outside: true,
      });

      // Render the button
      window.google.accounts.id.renderButton(
        buttonRef.current,
        {
          theme: 'outline',
          size: 'large',
          width: buttonRef.current.offsetWidth,
          text: 'signin_with',
        }
      );

      console.log('[Google Auth] Google Sign-In button rendered');
    } catch (error) {
      console.error('[Google Auth] Error initializing Google Sign-In:', error);
    }
  }, [isGoogleLoaded]);

  const handleCredentialResponse = async (response: any) => {
    if (isLoading) return;

    try {
      setIsLoading(true);
      console.log('[Google Auth] Received credential response');

      toast({
        title: "Authenticating",
        description: "Verifying your Google account...",
      });

      const serverResponse = await fetch('/api/auth/google', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ token: response.credential })
      });

      console.log('[Google Auth] Server response status:', serverResponse.status);

      if (!serverResponse.ok) {
        const errorData = await serverResponse.json();
        console.error('[Google Auth] Server error:', errorData);

        if (serverResponse.status === 403 && errorData.requiresApproval) {
          toast({
            title: "Account Created",
            description: "Your account is pending administrator approval.",
          });
          window.location.href = '/auth?pending=true';
          return;
        }

        throw new Error(errorData.message || 'Failed to authenticate with the server');
      }

      const responseData = await serverResponse.json();
      console.log('[Google Auth] Authentication successful');

      toast({
        title: "Success",
        description: "Successfully signed in with Google",
      });

      window.location.href = '/';
    } catch (error) {
      console.error('[Google Auth] Error:', error);

      let errorMessage = "Could not sign in with Google. Please try again.";
      if (error instanceof Error) {
        if (error.message.includes('network')) {
          errorMessage = "Network error occurred. Please check your connection and try again.";
        } else if (error.message.includes('Failed to authenticate')) {
          errorMessage = error.message;
        }
      }

      toast({
        title: "Authentication failed",
        description: errorMessage,
        variant: "destructive",
      });

      setIsLoading(false);
    }
  };

  return (
    <div className="w-full">
      {isLoading && (
        <div className="flex items-center justify-center gap-2 p-2 border rounded-md">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Signing in...</span>
        </div>
      )}
      <div
        ref={buttonRef}
        className={isLoading ? 'hidden' : 'w-full'}
        style={{ minHeight: '40px' }}
      />
    </div>
  );
}