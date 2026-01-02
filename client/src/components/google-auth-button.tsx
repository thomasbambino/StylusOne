import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { buildApiUrl, isNativePlatform } from "@/lib/capacitor";
import { GoogleAuth } from '@codetrix-studio/capacitor-google-auth';
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { CapacitorHttp, Capacitor } from '@capacitor/core';
import { queryClient } from "@/lib/queryClient";

// Check if Google Auth is configured for the current platform
const isGoogleAuthConfigured = () => {
  if (!isNativePlatform()) return true; // Web always uses OAuth redirect
  const platform = Capacitor.getPlatform();
  const clientId = platform === 'ios'
    ? import.meta.env.VITE_GOOGLE_IOS_CLIENT_ID
    : import.meta.env.VITE_GOOGLE_CLIENT_ID;
  return !!clientId;
};

export function GoogleAuthButton() {
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleGoogleSignIn = async () => {
    setIsLoading(true);

    try {
      if (isNativePlatform()) {
        // Check if Google Auth is configured for this platform
        if (!isGoogleAuthConfigured()) {
          toast({
            title: "Google Sign-In Not Available",
            description: "Google Sign-In is not configured for this platform yet.",
            variant: "destructive"
          });
          setIsLoading(false);
          return;
        }

        // Use native Google Sign-In on mobile
        console.log('Starting native Google sign-in...');
        const result = await GoogleAuth.signIn();
        console.log('Native sign-in completed, result:', result);

        // Send ID token to backend using CapacitorHttp (required for native platforms)
        const url = buildApiUrl('/api/auth/google');
        console.log('Sending ID token to backend:', url);

        const response = await CapacitorHttp.post({
          url,
          headers: { 'Content-Type': 'application/json' },
          data: { token: result.authentication.idToken },
        });

        console.log('Auth response:', response.status);
        console.log('Auth response data:', JSON.stringify(response.data, null, 2));

        if (response.status !== 200) {
          if (response.status === 403 && response.data?.requiresApproval) {
            // User account pending approval
            window.location.href = '/auth?pending=true';
            return;
          }
          throw new Error(response.data?.message || 'Authentication failed');
        }

        // Success - manually update the user in the query cache
        console.log('Authentication successful!');
        console.log('User data:', JSON.stringify(response.data, null, 2));
        console.log('User role:', response.data.role);
        console.log('User approved:', response.data.approved);
        queryClient.setQueryData(["/api/user"], response.data);

        // Reload to trigger auth state update - check for redirect parameter
        const redirectTo = new URLSearchParams(window.location.search).get('redirect') || '/';
        console.log('Redirecting to:', redirectTo);
        window.location.href = redirectTo;
      } else {
        // Use web OAuth flow - pass redirect parameter if present
        const redirectParam = new URLSearchParams(window.location.search).get('redirect');
        const authUrl = buildApiUrl('/api/auth/google/start');
        window.location.href = redirectParam ? `${authUrl}?redirect=${encodeURIComponent(redirectParam)}` : authUrl;
      }
    } catch (error) {
      console.error('Google Sign-In error:', error);
      console.error('Error details:', JSON.stringify(error, null, 2));

      let errorMessage = "Failed to sign in with Google";
      if (error instanceof Error) {
        errorMessage = error.message;
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
      }

      toast({
        title: "Sign In Failed",
        description: errorMessage,
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