import React from 'react';
import { Button } from "@/components/ui/button";
import { signInWithRedirect, getRedirectResult } from 'firebase/auth';
import { auth, googleProvider, authInitialized } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';

export function GoogleAuthButton() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = React.useState(false);

  // Handle redirect result when user returns from Google OAuth
  React.useEffect(() => {
    const handleRedirectResult = async () => {
      try {
        // Wait for Firebase auth to be fully initialized with persistence
        console.log('[Google Auth] Waiting for Firebase initialization...');
        while (!authInitialized) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        console.log('[Google Auth] Firebase initialized, checking for redirect result...');

        const result = await getRedirectResult(auth);

        // No result means user hasn't been redirected yet
        if (!result) {
          console.log('[Google Auth] No redirect result found');
          return;
        }

        console.log('[Google Auth] Got redirect result:', result.user.email);
        setIsLoading(true);

        const idToken = await result.user.getIdToken();
        console.log('[Google Auth] Got ID token, sending to server...');

        toast({
          title: "Google Sign-in Successful",
          description: "Completing authentication with server...",
        });

        const response = await fetch('/api/auth/google', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ token: idToken })
        });

        console.log('[Google Auth] Server response status:', response.status);

        if (!response.ok) {
          const errorData = await response.json();
          console.error('[Google Auth] Server error:', errorData);

          if (response.status === 403 && errorData.requiresApproval) {
            toast({
              title: "Account Created",
              description: "Your account is pending administrator approval.",
            });
            window.location.href = '/auth?pending=true';
            return;
          }

          throw new Error(errorData.message || 'Failed to authenticate with the server');
        }

        const responseData = await response.json();
        console.log('[Google Auth] Authentication successful:', responseData);

        toast({
          title: "Success",
          description: "Successfully signed in with Google",
        });

        console.log('[Google Auth] Redirecting to home page...');
        window.location.href = '/';
      } catch (error) {
        console.error('[Google Auth] Redirect result error:', error);

        let errorMessage = "Could not sign in with Google. Please try again.";
        if (error instanceof Error) {
          if (error.message.includes('network')) {
            errorMessage = "Network error occurred. Please check your connection and try again.";
          } else if (error.message.includes('auth/unauthorized-domain')) {
            errorMessage = "This domain is not authorized for Google Sign-In. Please contact the administrator.";
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

    handleRedirectResult();
  }, [toast]);

  const handleGoogleSignIn = async () => {
    if (isLoading) return;

    try {
      setIsLoading(true);

      toast({
        title: "Redirecting to Google",
        description: "You will be redirected to sign in with your Google account",
      });

      // Redirect to Google OAuth (full page redirect, not popup)
      await signInWithRedirect(auth, googleProvider);
    } catch (error) {
      console.error('Google sign in error:', error);

      let errorMessage = "Could not sign in with Google. Please try again.";
      if (error instanceof Error) {
        if (error.message.includes('network')) {
          errorMessage = "Network error occurred. Please check your connection and try again.";
        } else if (error.message.includes('auth/unauthorized-domain')) {
          errorMessage = "This domain is not authorized for Google Sign-In. Please contact the administrator.";
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
    <Button 
      variant="outline" 
      className="w-full flex items-center gap-2" 
      onClick={handleGoogleSignIn}
      disabled={isLoading}
    >
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <img 
          src="/google-g-logo.png" 
          alt="Google logo" 
          className="w-5 h-5"
        />
      )}
      Sign in with Google
    </Button>
  );
}