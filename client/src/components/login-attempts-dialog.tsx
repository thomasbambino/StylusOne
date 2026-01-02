import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { ScrollArea } from "@/components/ui/scroll-area";
import { LoginAttempt } from "@shared/schema";
import { format } from "date-fns";
import { Shield, CheckCircle2, XCircle, Monitor, Smartphone, Tablet, Tv } from "lucide-react";
import { ISPIcon } from "@/components/isp-icons/ISPIcon.js";
import { Badge } from "@/components/ui/badge";

// Parse user agent to determine device type
function getDeviceInfo(userAgent: string | null | undefined): { type: string; icon: React.ReactNode; label: string } {
  if (!userAgent) return { type: 'unknown', icon: <Monitor className="h-4 w-4" />, label: 'Unknown' };

  const ua = userAgent.toLowerCase();

  // Check for TV/Android TV
  if (ua.includes('android tv') || ua.includes('androidtv') || ua.includes('tv')) {
    return { type: 'tv', icon: <Tv className="h-4 w-4" />, label: 'Android TV' };
  }

  // Check for iOS
  if (ua.includes('iphone')) {
    return { type: 'ios', icon: <Smartphone className="h-4 w-4" />, label: 'iOS (iPhone)' };
  }
  if (ua.includes('ipad')) {
    return { type: 'ios', icon: <Tablet className="h-4 w-4" />, label: 'iOS (iPad)' };
  }

  // Check for Android mobile/tablet
  if (ua.includes('android')) {
    if (ua.includes('mobile')) {
      return { type: 'android', icon: <Smartphone className="h-4 w-4" />, label: 'Android' };
    }
    return { type: 'android', icon: <Tablet className="h-4 w-4" />, label: 'Android Tablet' };
  }

  // Check for Mac
  if (ua.includes('macintosh') || ua.includes('mac os')) {
    return { type: 'web', icon: <Monitor className="h-4 w-4" />, label: 'Web (Mac)' };
  }

  // Check for Windows
  if (ua.includes('windows')) {
    return { type: 'web', icon: <Monitor className="h-4 w-4" />, label: 'Web (Windows)' };
  }

  // Check for Linux
  if (ua.includes('linux')) {
    return { type: 'web', icon: <Monitor className="h-4 w-4" />, label: 'Web (Linux)' };
  }

  return { type: 'web', icon: <Monitor className="h-4 w-4" />, label: 'Web' };
}

export function LoginAttemptsDialog() {
  const { data: loginAttempts = [] } = useQuery<LoginAttempt[]>({
    queryKey: ["/api/login-attempts"],
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="border-primary text-primary hover:bg-primary/10">
          <Shield className="h-4 w-4 mr-2" />
          Login Attempts
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[800px] max-h-[80vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle>Login Attempts</DialogTitle>
        </DialogHeader>
        <ScrollArea className="h-[600px] rounded-md p-4">
          <div className="space-y-4">
            {loginAttempts.map((attempt) => (
              <div
                key={attempt.id}
                className="p-4 rounded-lg bg-card space-y-2"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className="flex items-center gap-2">
                      {attempt.type === 'success' ? (
                        <CheckCircle2 className="h-5 w-5 text-green-500" />
                      ) : (
                        <XCircle className="h-5 w-5 text-red-500" />
                      )}
                      <p className="font-medium">{attempt.identifier}</p>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {format(new Date(attempt.timestamp), "PPp")}
                    </p>
                  </div>
                  <div className="text-right space-y-1">
                    <p className="text-sm font-medium">
                      {attempt.type === 'success' ? 'Successful Login' : 'Failed Attempt'}
                    </p>
                    {(() => {
                      const deviceInfo = getDeviceInfo((attempt as any).user_agent);
                      return (
                        <Badge variant="outline" className="flex items-center gap-1 w-fit ml-auto">
                          {deviceInfo.icon}
                          <span>{deviceInfo.label}</span>
                        </Badge>
                      );
                    })()}
                  </div>
                </div>
                <div className="bg-muted p-3 rounded-md space-y-1">
                  <p className="font-medium">IP: {attempt.ip}</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2">
                    {attempt.isp && (
                      <p className="text-sm flex items-center gap-2">
                        <span className="text-muted-foreground">ISP:</span>
                        <ISPIcon 
                          ispName={attempt.isp} 
                          className="h-6 w-6"
                          size={27}
                        />
                        <span>{attempt.isp}</span>
                      </p>
                    )}
                    {attempt.city && (
                      <p className="text-sm">
                        <span className="text-muted-foreground">City:</span> {attempt.city}
                      </p>
                    )}
                    {attempt.region && (
                      <p className="text-sm">
                        <span className="text-muted-foreground">Region:</span> {attempt.region}
                      </p>
                    )}
                    {attempt.country && (
                      <p className="text-sm">
                        <span className="text-muted-foreground">Country:</span> {attempt.country}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {loginAttempts.length === 0 && (
              <div className="text-center text-muted-foreground py-4">
                No login attempts found
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}