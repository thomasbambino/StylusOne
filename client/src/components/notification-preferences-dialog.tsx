import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { NavIconButton } from "@/components/ui/nav-icon-button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Bell } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Service, NotificationPreference } from "@shared/schema";
import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { EmailTemplateDialog } from "./email-template-dialog";
import { Button } from "@/components/ui/button";

interface NotificationPreferencesDialogProps {
  children?: React.ReactNode;
}

export function NotificationPreferencesDialog({ children }: NotificationPreferencesDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = user?.role === 'admin';
  const [showTemplates, setShowTemplates] = useState(false);
  const [notifications, setNotifications] = useState<Record<number, { email: string; enabled: boolean }>>({});

  const { data: services = [] } = useQuery<Service[]>({
    queryKey: ["/api/services"],
  });

  const { data: preferences = [] } = useQuery<NotificationPreference[]>({
    queryKey: ["/api/notification-preferences"],
    gcTime: 0,
    onSuccess: (prefs: NotificationPreference[]) => {
      const newState: Record<number, { email: string; enabled: boolean }> = {};
      prefs.forEach(pref => {
        newState[pref.serviceId] = {
          email: pref.email,
          enabled: pref.enabled
        };
      });
      setNotifications(newState);
    }
  });

  const updatePreferenceMutation = useMutation({
    mutationFn: async (data: { serviceId: number; email: string; enabled: boolean }) => {
      const res = await apiRequest("POST", "/api/notification-preferences", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notification-preferences"] });
      toast({
        title: "Preferences updated",
        description: "Your notification preferences have been saved.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update preferences",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const testNotificationMutation = useMutation({
    mutationFn: async (data: { templateId: number; email: string }) => {
      const res = await apiRequest("POST", "/api/test-notification", data);
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Test email sent",
        description: "Check your inbox for the test notification.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to send test email",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handlePreferenceChange = async (
    serviceId: number,
    field: keyof { email: string; enabled: boolean },
    value: string | boolean
  ) => {
    const currentState = notifications[serviceId] || { email: "", enabled: true };
    const newState = {
      ...currentState,
      [field]: value
    };
    setNotifications(prev => ({ ...prev, [serviceId]: newState }));

    if (newState.email) {
      updatePreferenceMutation.mutate({
        serviceId,
        email: newState.email,
        enabled: newState.enabled
      });
    }
  };

  return (
    <Dialog modal={false}>
      <DialogTrigger asChild>
        {children || (
          <NavIconButton>
            <Bell className="h-4 w-4" />
          </NavIconButton>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Notification Preferences</DialogTitle>
        </DialogHeader>
        <div className="space-y-6">
          {isAdmin && (
            <div className="flex justify-end">
              <Button onClick={() => setShowTemplates(true)}>
                Manage Templates
              </Button>
            </div>
          )}
          <div className="space-y-4">
            {services.map((service) => {
              const notification = notifications[service.id] || { email: "", enabled: true };
              return (
                <div key={service.id} className="flex items-center gap-4">
                  <div className="flex-1">
                    <p className="text-sm font-medium">{service.name}</p>
                    <Input
                      type="email"
                      placeholder="Email for notifications"
                      value={notification.email}
                      onChange={(e) => handlePreferenceChange(service.id, "email", e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <Switch
                    checked={notification.enabled}
                    onCheckedChange={(checked) => handlePreferenceChange(service.id, "enabled", checked)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </DialogContent>
      {isAdmin && (
        <EmailTemplateDialog
          open={showTemplates}
          onOpenChange={setShowTemplates}
          onTestEmail={(templateId: number, email: string) =>
            testNotificationMutation.mutate({ templateId, email })
          }
        />
      )}
    </Dialog>
  );
}