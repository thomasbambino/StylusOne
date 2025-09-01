import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { User, updateUserSchema } from "@shared/schema";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Settings as SettingsIcon, Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function UserPreferencesDialog({ user }: { user: User }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const form = useForm({
    resolver: zodResolver(updateUserSchema),
    defaultValues: {
      id: user.id,
      show_refresh_interval: user.show_refresh_interval ?? true,
      show_last_checked: user.show_last_checked ?? true,
      show_service_url: user.show_service_url ?? true,
    },
  });

  const updatePreferencesMutation = useMutation({
    mutationFn: async (data: Parameters<typeof updateUserSchema.parse>[0]) => {
      const res = await apiRequest("PATCH", `/api/users/${user.id}/preferences`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      toast({
        title: "Preferences updated",
        description: "Your display preferences have been updated successfully",
      });
      setOpen(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update preferences",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <SettingsIcon className="h-4 w-4 mr-2" />
          UI Settings
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>UI Settings</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="visibility">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="branding">Branding</TabsTrigger>
            <TabsTrigger value="visibility">Visibility</TabsTrigger>
          </TabsList>
          <TabsContent value="general">
            <div className="text-sm text-muted-foreground">
              General settings coming soon
            </div>
          </TabsContent>
          <TabsContent value="branding">
            <div className="text-sm text-muted-foreground">
              Branding settings coming soon
            </div>
          </TabsContent>
          <TabsContent value="visibility">
            <Form {...form}>
              <form onSubmit={form.handleSubmit((data) => updatePreferencesMutation.mutate(data))} className="space-y-6">
                <div className="space-y-4">
                  <div className="space-y-3">
                    <FormField
                      control={form.control}
                      name="show_refresh_interval"
                      render={({ field }) => (
                        <FormItem>
                          <div className="flex items-center justify-between">
                            <Label htmlFor="show_refresh_interval" className="text-sm cursor-pointer">Refresh Interval</Label>
                            <Switch
                              id="show_refresh_interval"
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
                          </div>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="show_last_checked"
                      render={({ field }) => (
                        <FormItem>
                          <div className="flex items-center justify-between">
                            <Label htmlFor="show_last_checked" className="text-sm cursor-pointer">Last Checked Time</Label>
                            <Switch
                              id="show_last_checked"
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
                          </div>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="show_service_url"
                      render={({ field }) => (
                        <FormItem>
                          <div className="flex items-center justify-between">
                            <Label htmlFor="show_service_url" className="text-sm cursor-pointer">Service URL</Label>
                            <Switch
                              id="show_service_url"
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
                          </div>
                        </FormItem>
                      )}
                    />
                  </div>
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={updatePreferencesMutation.isPending}
                >
                  {updatePreferencesMutation.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Save Changes
                </Button>
              </form>
            </Form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}