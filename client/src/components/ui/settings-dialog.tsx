import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { NavIconButton } from "@/components/ui/nav-icon-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Settings, updateSettingsSchema } from "@shared/schema";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Settings as SettingsIcon, Loader2, RefreshCw, Mail } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/use-auth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState, useEffect } from "react";
import { ImageUpload } from "./image-upload";
import { EmailTemplateDialog } from "../email-template-dialog";
import { Textarea } from "@/components/ui/textarea";
import React from 'react';

export function SettingsDialog() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [showEmailTemplates, setShowEmailTemplates] = useState(false);
  const { user } = useAuth();
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const isSuperAdmin = user?.role === 'superadmin';
  const [currentTab, setCurrentTab] = useState("general");

  const { data: settings } = useQuery<Settings>({
    queryKey: ["/api/settings"],
    enabled: open,
  });

  const form = useForm({
    resolver: zodResolver(updateSettingsSchema),
    defaultValues: {
      id: settings?.id ?? 1,
      favicon_url: settings?.favicon_url ?? "",
      favicon_label: settings?.favicon_label ?? "",
      tracking_code: settings?.tracking_code ?? "",
      default_role: settings?.default_role ?? "pending",
      site_title: settings?.site_title ?? "",
      font_family: settings?.font_family ?? "",
      login_description: settings?.login_description ?? "",
      online_color: settings?.online_color ?? "#22c55e",
      offline_color: settings?.offline_color ?? "#ef4444",
      discord_url: settings?.discord_url ?? "https://discord.gg/YhGnr92Bep",
      show_refresh_interval: settings?.show_refresh_interval ?? true,
      show_last_checked: settings?.show_last_checked ?? true,
      show_service_url: settings?.show_service_url ?? true,
      show_status_badge: settings?.show_status_badge ?? true,
      admin_show_refresh_interval: settings?.admin_show_refresh_interval ?? true,
      admin_show_last_checked: settings?.admin_show_last_checked ?? true,
      admin_show_service_url: settings?.admin_show_service_url ?? true,
      admin_show_status_badge: settings?.admin_show_status_badge ?? true,
      logo_url: settings?.logo_url ?? "",
      logo_url_large: settings?.logo_url_large ?? "",
    },
  });

  // Watch for favicon label changes
  useEffect(() => {
    const faviconLabel = form.watch("favicon_label");
    if (faviconLabel) {
      document.title = faviconLabel;
    }
  }, [form.watch("favicon_label")]);

  // Reset form when settings are loaded or dialog is opened
  useEffect(() => {
    if (settings && open) {
      form.reset({
        id: settings.id,
        favicon_url: settings.favicon_url,
        favicon_label: settings.favicon_label,
        tracking_code: settings.tracking_code,
        default_role: settings.default_role,
        site_title: settings.site_title,
        font_family: settings.font_family,
        login_description: settings.login_description,
        online_color: settings.online_color,
        offline_color: settings.offline_color,
        discord_url: settings.discord_url,
        show_refresh_interval: settings.show_refresh_interval,
        show_last_checked: settings.show_last_checked,
        show_service_url: settings.show_service_url,
        show_status_badge: settings.show_status_badge,
        admin_show_refresh_interval: settings.admin_show_refresh_interval,
        admin_show_last_checked: settings.admin_show_last_checked,
        admin_show_service_url: settings.admin_show_service_url,
        admin_show_status_badge: settings.admin_show_status_badge,
        logo_url: settings.logo_url,
        logo_url_large: settings.logo_url_large,
      });

      // Set the document title when settings are loaded
      if (settings.favicon_label) {
        document.title = settings.favicon_label;
      }
    }
  }, [settings, open, form]);

  const updateSettingsMutation = useMutation({
    mutationFn: async (data: Parameters<typeof updateSettingsSchema.parse>[0]) => {
      // Only send the fields that are relevant to the current tab
      const relevantData = { id: data.id };

      if (currentTab === "general") {
        Object.assign(relevantData, {
          site_title: data.site_title,
          default_role: data.default_role,
          discord_url: data.discord_url,
          font_family: data.font_family,
          login_description: data.login_description,
        });
      } else if (currentTab === "branding") {
        Object.assign(relevantData, {
          logo_url: data.logo_url,
          logo_url_large: data.logo_url_large,
          favicon_url: data.favicon_url,
          favicon_label: data.favicon_label,
          tracking_code: data.tracking_code,
          online_color: data.online_color,
          offline_color: data.offline_color,
        });

        // Update the document title immediately after successful mutation
        if (data.favicon_label) {
          document.title = data.favicon_label;
        }
      } else if (currentTab === "visibility") {
        Object.assign(relevantData, {
          show_refresh_interval: data.show_refresh_interval,
          show_last_checked: data.show_last_checked,
          show_service_url: data.show_service_url,
          show_status_badge: data.show_status_badge,
          admin_show_refresh_interval: data.admin_show_refresh_interval,
          admin_show_last_checked: data.admin_show_last_checked,
          admin_show_service_url: data.admin_show_service_url,
          admin_show_status_badge: data.admin_show_status_badge,
        });
      }

      const res = await apiRequest("PATCH", "/api/settings", relevantData);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({
        title: "Settings updated",
        description: "UI settings have been updated successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update settings",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const ampForm = useForm({
    defaultValues: {
      amp_url: "",
      amp_username: "",
      amp_password: "",
    },
  });

  const updateAMPCredentialsMutation = useMutation({
    mutationFn: async (data: { amp_url: string; amp_username: string; amp_password: string }) => {
      const res = await apiRequest("POST", "/api/update-amp-credentials", data);
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "AMP Credentials Updated",
        description: "Your AMP credentials have been updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update AMP credentials",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const testAMPConnection = async () => {
    try {
      setIsTestingConnection(true);
      const res = await apiRequest("GET", "/api/amp-test");
      const data = await res.json();

      if (data.success) {
        toast({
          title: "Connection Successful",
          description: `Connected to AMP. Found ${data.instanceCount} instances.`,
        });
      } else {
        toast({
          title: "Connection Failed",
          description: data.message || "Could not connect to AMP server.",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Connection Test Failed",
        description: error instanceof Error ? error.message : "An unknown error occurred",
        variant: "destructive",
      });
    } finally {
      setIsTestingConnection(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <NavIconButton>
          <SettingsIcon className="h-4 w-4" />
        </NavIconButton>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Admin Settings</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="general" className="space-y-4" onValueChange={setCurrentTab}>
          <TabsList className="w-full flex space-x-1">
            <TabsTrigger value="general" className="flex-1">General</TabsTrigger>
            <TabsTrigger value="branding" className="flex-1">Branding</TabsTrigger>
            <TabsTrigger value="visibility" className="flex-1">Visibility</TabsTrigger>
            {isSuperAdmin && (
              <>
                <TabsTrigger value="amp" className="flex-1">AMP</TabsTrigger>
                <TabsTrigger value="email" className="flex-1">
                  <Mail className="h-4 w-4 mr-2" />
                  Email
                </TabsTrigger>
              </>
            )}
          </TabsList>

          <TabsContent value="general" className="mt-0">
            <Form {...form}>
              <form onSubmit={form.handleSubmit((data) => updateSettingsMutation.mutate(data))} className="space-y-4">
                <FormField
                  control={form.control}
                  name="site_title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Site Title</FormLabel>
                      <FormControl>
                        <Input placeholder="Homelab Dashboard" {...field} value={field.value || ""} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                {isSuperAdmin && (
                  <FormField
                    control={form.control}
                    name="default_role"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Default User Role</FormLabel>
                        <FormControl>
                          <Input placeholder="pending" {...field} value={field.value || ""} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                )}
                <FormField
                  control={form.control}
                  name="discord_url"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Discord Invite URL</FormLabel>
                      <FormControl>
                        <Input placeholder="https://discord.gg/..." {...field} value={field.value || ""} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="font_family"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Font Family</FormLabel>
                      <FormControl>
                        <Input placeholder="Inter" {...field} value={field.value || ""} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="login_description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Login Page Description</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Monitor your services and game servers..."
                          {...field}
                          value={field.value || ""}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={updateSettingsMutation.isPending}>
                  {updateSettingsMutation.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Save Changes
                </Button>
              </form>
            </Form>
          </TabsContent>
          <TabsContent value="branding">
            <Form {...form}>
              <form onSubmit={form.handleSubmit((data) => updateSettingsMutation.mutate(data))} className="space-y-4">
                <FormField
                  control={form.control}
                  name="logo_url"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Header Logo</FormLabel>
                      <FormControl>
                        <ImageUpload
                          value={field.value}
                          onChange={field.onChange}
                          onClear={() => field.onChange("")}
                          uploadType="site"
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="logo_url_large"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Login Page Logo</FormLabel>
                      <FormControl>
                        <ImageUpload
                          value={field.value}
                          onChange={field.onChange}
                          onClear={() => field.onChange("")}
                          uploadType="site"
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <div className="flex gap-4">
                  <FormField
                    control={form.control}
                    name="favicon_url"
                    render={({ field }) => (
                      <FormItem className="flex-1">
                        <FormLabel>Favicon</FormLabel>
                        <FormControl>
                          <ImageUpload
                            value={field.value}
                            onChange={field.onChange}
                            onClear={() => field.onChange("")}
                            uploadType="favicon"
                            accept=".ico,.png"
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="favicon_label"
                    render={({ field }) => (
                      <FormItem className="flex-1">
                        <FormLabel>Favicon Label</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Enter favicon label"
                            {...field}
                            value={field.value || ""}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="tracking_code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Analytics Tracking Code</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Insert your tracking code here..."
                          {...field}
                          value={field.value || ""}
                          className="font-mono text-sm"
                          rows={4}
                        />
                      </FormControl>
                      <p className="text-xs text-muted-foreground">
                        Paste your analytics tracking code here. It will be inserted in the &lt;head&gt; section of your HTML.
                      </p>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="online_color"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Online Status Color</FormLabel>
                      <div className="flex gap-2">
                        <FormControl>
                          <Input type="color" {...field} value={field.value || "#22c55e"} className="w-16 p-1 h-9" />
                        </FormControl>
                        <Input {...field} value={field.value || "#22c55e"} className="flex-1" />
                      </div>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="offline_color"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Offline Status Color</FormLabel>
                      <div className="flex gap-2">
                        <FormControl>
                          <Input type="color" {...field} value={field.value || "#ef4444"} className="w-16 p-1 h-9" />
                        </FormControl>
                        <Input {...field} value={field.value || "#ef4444"} className="flex-1" />
                      </div>
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={updateSettingsMutation.isPending}>
                  {updateSettingsMutation.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Save Changes
                </Button>
              </form>
            </Form>
          </TabsContent>
          <TabsContent value="visibility">
            <Form {...form}>
              <form onSubmit={form.handleSubmit((data) => updateSettingsMutation.mutate(data))} className="space-y-6">
                <div className="space-y-6">
                  <div>
                    <h3 className="text-sm font-medium mb-3">Administrator View</h3>
                    <div className="space-y-3">
                      <FormField
                        control={form.control}
                        name="admin_show_status_badge"
                        render={({ field }) => (
                          <FormItem>
                            <div className="flex items-center justify-between">
                              <FormLabel htmlFor="admin_show_status_badge" className="text-sm cursor-pointer">Show Status Badge</FormLabel>
                              <Switch
                                id="admin_show_status_badge"
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </div>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="admin_show_refresh_interval"
                        render={({ field }) => (
                          <FormItem>
                            <div className="flex items-center justify-between">
                              <FormLabel htmlFor="admin_show_refresh_interval" className="text-sm cursor-pointer">Show Refresh Interval</FormLabel>
                              <Switch
                                id="admin_show_refresh_interval"
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </div>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="admin_show_last_checked"
                        render={({ field }) => (
                          <FormItem>
                            <div className="flex items-center justify-between">
                              <FormLabel htmlFor="admin_show_last_checked" className="text-sm cursor-pointer">Show Last Checked Time</FormLabel>
                              <Switch
                                id="admin_show_last_checked"
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </div>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="admin_show_service_url"
                        render={({ field }) => (
                          <FormItem>
                            <div className="flex items-center justify-between">
                              <FormLabel htmlFor="admin_show_service_url" className="text-sm cursor-pointer">Show Service URL</FormLabel>
                              <Switch
                                id="admin_show_service_url"
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </div>
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                  <div>
                    <h3 className="text-sm font-medium mb-3">Regular User View</h3>
                    <div className="space-y-3">
                      <FormField
                        control={form.control}
                        name="show_status_badge"
                        render={({ field }) => (
                          <FormItem>
                            <div className="flex items-center justify-between">
                              <FormLabel htmlFor="show_status_badge" className="text-sm cursor-pointer">Show Status Badge</FormLabel>
                              <Switch
                                id="show_status_badge"
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </div>
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="show_refresh_interval"
                        render={({ field }) => (
                          <FormItem>
                            <div className="flex items-center justify-between">
                              <FormLabel htmlFor="show_refresh_interval" className="text-sm cursor-pointer">Show Refresh Interval</FormLabel>
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
                              <FormLabel htmlFor="show_last_checked" className="text-sm cursor-pointer">Show Last Checked Time</FormLabel>
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
                              <FormLabel htmlFor="show_service_url" className="text-sm cursor-pointer">Show Service URL</FormLabel>
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
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={updateSettingsMutation.isPending}
                >
                  {updateSettingsMutation.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Save Changes
                </Button>
              </form>
            </Form>
          </TabsContent>
          {isSuperAdmin && (
            <>
              <TabsContent value="amp">
                <Form {...ampForm}>
                  <form onSubmit={ampForm.handleSubmit((data) => updateAMPCredentialsMutation.mutate(data))} className="space-y-4">
                    <FormField
                      control={ampForm.control}
                      name="amp_url"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>AMP Server URL</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="https://your-amp-server.com"
                              {...field}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={ampForm.control}
                      name="amp_username"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>AMP Username</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="AMP admin username"
                              {...field}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={ampForm.control}
                      name="amp_password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>AMP Password</FormLabel>
                          <FormControl>
                            <Input
                              type="password"
                              placeholder="AMP admin password"
                              {...field}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <div className="flex gap-2">
                      <Button
                        type="submit"
                        className="flex-1"
                        disabled={updateAMPCredentialsMutation.isPending}
                      >
                        {updateAMPCredentialsMutation.isPending && (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        )}
                        Save Credentials
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={testAMPConnection}
                        disabled={isTestingConnection}
                      >
                        {isTestingConnection ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="mr-2 h-4 w-4" />
                        )}
                        Test Connection
                      </Button>
                    </div>
                  </form>
                </Form>
              </TabsContent>
              <TabsContent value="email" className="mt-4">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-medium">Email Templates</h3>
                    <Button onClick={() => setShowEmailTemplates(true)}>
                      <Mail className="h-4 w-4 mr-2" />
                      Manage Templates
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Customize email templates for system notifications, alerts, and user communications.
                    Each template supports variables such as &#123;&#123;appName&#125;&#125;, &#123;&#123;logoUrl&#125;&#125;, and specific fields for different types of notifications.
                  </p>
                  <EmailTemplateDialog
                    open={showEmailTemplates}
                    onOpenChange={setShowEmailTemplates}
                    onTestEmail={async (templateId: number, email: string) => {
                      try {
                        const res = await apiRequest(
                          "POST",
                          `/api/email-templates/${templateId}/test`,
                          { email }
                        );

                        if (!res.ok) {
                          throw new Error("Failed to send test email");
                        }

                        toast({
                          title: "Test Email Sent",
                          description: "Check your inbox for the test email.",
                        });
                      } catch (error) {
                        toast({
                          title: "Failed to Send Test Email",
                          description: error instanceof Error ? error.message : "An error occurred",
                          variant: "destructive",
                        });
                      }
                    }}
                  />
                </div>

              </TabsContent>
            </>
          )}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

export function SettingsDialog2({ children }: { children?: React.ReactNode }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        {children || (
          <NavIconButton>
            <SettingsIcon className="h-4 w-4" />
          </NavIconButton>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        {/* Dialog content */}
      </DialogContent>
    </Dialog>
  );
}