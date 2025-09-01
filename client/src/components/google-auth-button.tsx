import React from 'react';
import { Button } from "@/components/ui/button";
import { signInWithPopup } from 'firebase/auth';
import { auth, googleProvider } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';

export function GoogleAuthButton() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = React.useState(false);

  const handleGoogleSignIn = async () => {
    if (isLoading) return;

    try {
      setIsLoading(true);

      toast({
        title: "Connecting to Google",
        description: "Please complete the sign-in in the popup window",
      });

      const result = await signInWithPopup(auth, googleProvider);
      const idToken = await result.user.getIdToken();

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

      if (!response.ok) {
        const errorData = await response.json();

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

      await response.json();

      toast({
        title: "Success",
        description: "Successfully signed in with Google",
      });

      window.location.href = '/';
    } catch (error) {
      console.error('Google sign in error:', error);

      let errorMessage = "Could not sign in with Google. Please try again.";
      if (error instanceof Error) {
        if (error.message.includes('popup-closed-by-user')) {
          errorMessage = "The sign-in popup was closed. Please try again.";
        } else if (error.message.includes('network')) {
          errorMessage = "Network error occurred. Please check your connection and try again.";
        } else if (error.message.includes('popup-blocked')) {
          errorMessage = "Pop-up was blocked. Please allow pop-ups for this site and try again.";
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
    } finally {
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