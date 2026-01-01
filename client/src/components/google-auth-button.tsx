import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { buildApiUrl, isNativePlatform } from "@/lib/capacitor";
import { GoogleAuth } from '@codetrix-studio/capacitor-google-auth';
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { CapacitorHttp } from '@capacitor/core';
import { queryClient } from "@/lib/queryClient";

export function GoogleAuthButton() {
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleGoogleSignIn = async () => {
    setIsLoading(true);

    try {
      if (isNativePlatform()) {
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

        // Reload to trigger auth state update
        console.log('Redirecting to home...');
        window.location.href = '/';
      } else {
        // Use web OAuth flow
        window.location.href = buildApiUrl('/api/auth/google/start');
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