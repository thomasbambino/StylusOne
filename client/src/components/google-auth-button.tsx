import React from 'react';
import { Button } from "@/components/ui/button";

export function GoogleAuthButton() {
  const handleGoogleSignIn = () => {
    // Redirect to server-side OAuth flow
    window.location.href = '/api/auth/google/start';
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