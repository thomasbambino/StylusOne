import React from 'react';
import { Button } from "@/components/ui/button";
import { buildApiUrl } from "@/lib/capacitor";

export function GoogleAuthButton() {
  const handleGoogleSignIn = () => {
    // Redirect to server-side OAuth flow
    // Use buildApiUrl to support both web and native mobile apps
    window.location.href = buildApiUrl('/api/auth/google/start');
  };

  return (
    <Button
      variant="outline"
      className="w-full flex items-center gap-2"
      onClick={handleGoogleSignIn}
    >
      <img
        src="/google-g-logo.png"
        alt="Google logo"
        className="w-5 h-5"
      />
      Sign in with Google
    </Button>
  );
}