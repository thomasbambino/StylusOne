import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { buildApiUrl, isNativePlatform } from "@/lib/capacitor";
import { GoogleAuth } from '@codetrix-studio/capacitor-google-auth';
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

export function GoogleAuthButton() {
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleGoogleSignIn = async () => {
    setIsLoading(true);

    try {
      if (isNativePlatform()) {
        // Use native Google Sign-In on mobile
        const result = await GoogleAuth.signIn();

        // Send ID token to backend
        const response = await fetch(buildApiUrl('/api/auth/google'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include', // Important for session cookies
          body: JSON.stringify({ token: result.authentication.idToken }),
        });

        const data = await response.json();

        if (!response.ok) {
          if (response.status === 403 && data.requiresApproval) {
            // User account pending approval
            window.location.href = '/auth?pending=true';
            return;
          }
          throw new Error(data.message || 'Authentication failed');
        }

        // Success - reload to trigger auth state update
        window.location.href = '/';
      } else {
        // Use web OAuth flow
        window.location.href = buildApiUrl('/api/auth/google/start');
      }
    } catch (error) {
      console.error('Google Sign-In error:', error);
      toast({
        title: "Sign In Failed",
        description: error instanceof Error ? error.message : "Failed to sign in with Google",
        variant: "destructive"
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
        <Loader2 className="w-5 h-5 animate-spin" />
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