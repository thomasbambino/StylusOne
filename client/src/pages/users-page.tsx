import { useQuery, useMutation } from "@tanstack/react-query";
import { User, Settings } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Redirect, Link } from "wouter";
import { KeyRound, Loader2, Save, Shield, Trash2, ArrowLeft } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LoginAttemptsDialog } from "@/components/login-attempts-dialog";
import { format } from 'date-fns';
import { PageTransition } from "@/components/page-transition";
import { Separator } from "@/components/ui/separator"; // Import Separator
import { Copy, Check } from "lucide-react";


export default function UsersPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [tempPasswords, setTempPasswords] = useState<Record<number, string>>({});
  const [editingEmails, setEditingEmails] = useState<Record<number, string>>({});
  const [passwordDialog, setPasswordDialog] = useState<{ open: boolean; password: string; username: string; emailSent: boolean }>({
    open: false,
    password: '',
    username: '',
    emailSent: false
  });
  const [copiedPassword, setCopiedPassword] = useState(false);
  const isSuperAdmin = user?.role === 'superadmin';

  const { data: users = [] } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  const { data: settings } = useQuery<Settings>({
    queryKey: ["/api/settings"],
  });

  const updateUserMutation = useMutation({
    mutationFn: async (data: { id: number; role?: string; approved?: boolean; can_view_nsfw?: boolean; email?: string; enabled?: boolean }) => {
      const res = await apiRequest("PATCH", `/api/users/${data.id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({
        title: "User updated",
        description: "User settings have been updated successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update user",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (userId: number) => {
      const res = await apiRequest("DELETE", `/api/users/${userId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({
        title: "User deleted",
        description: "User has been deleted successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to delete user",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateSettingsMutation = useMutation({
    mutationFn: async (data: { defaultRole: string }) => {
      const res = await apiRequest("PATCH", "/api/settings", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({
        title: "Settings updated",
        description: "Default role settings have been updated successfully",
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

  const resetPasswordMutation = useMutation({
    mutationFn: async ({ userId, username }: { userId: number; username: string }) => {
      const res = await apiRequest("POST", "/api/admin/reset-user-password", { userId });
      const data = await res.json();
      return { ...data, username };
    },
    onSuccess: (data) => {
      if (data.tempPassword) {
        // Open dialog with password
        setPasswordDialog({
          open: true,
          password: data.tempPassword,
          username: data.username,
          emailSent: data.emailSent
        });
      }
      // Still send toast for email notification
      if (data.emailSent) {
        toast({
          title: "Password reset",
          description: "A password reset email has been sent to the user.",
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to reset password",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleEmailChange = (userId: number, email: string) => {
    setEditingEmails(prev => ({ ...prev, [userId]: email }));
  };

  const saveEmail = async (userId: number) => {
    const email = editingEmails[userId];
    if (email !== undefined) {
      await updateUserMutation.mutateAsync({ id: userId, email });
      setEditingEmails(prev => {
        const newState = { ...prev };
        delete newState[userId];
        return newState;
      });
    }
  };

  if (user?.role !== 'admin' && user?.role !== 'superadmin') {
    return <Redirect to="/" />;
  }

  const canModifyUser = (targetUser: User) => {
    if (!user) return false;
    if (user.role === 'superadmin') {
      if (targetUser.role === 'superadmin' && targetUser.id !== user.id) {
        return false;
      }
      return true;
    }
    if (user.role === 'admin') {
      if (targetUser.role === 'superadmin' || (targetUser.role === 'admin' && targetUser.id !== user.id)) {
        return false;
      }
      return true;
    }
    return false;
  };

  return (
    <PageTransition>
      <div className="min-h-screen bg-background">

        <main className="container mx-auto px-4 pb-6 space-y-6">
          <Card className="border-0 shadow-none">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle>Users</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <Label>Default role for new users:</Label>
                  <Select
                    value={settings?.default_role}
                    onValueChange={(value) => updateSettingsMutation.mutate({ defaultRole: value })}
                  >
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="user">User</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                    </SelectContent>
                  </Select>
                  {isSuperAdmin && <LoginAttemptsDialog />}
                </div>
              </div>
            </CardContent>
          </Card>

          <Separator className="mx-auto w-full max-w-[calc(100%-2rem)] bg-border/60" />

          <div className="grid gap-4">
            {[...users]
              .sort((a, b) => a.id - b.id)
              .map((u) => (
                <Card key={u.id} className="border-0 shadow-none">
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{u.username}</p>
                          {u.role === 'superadmin' && (
                            <p className="text-sm font-medium text-primary flex items-center gap-1">
                              <Shield className="h-4 w-4 text-blue-500" />
                              Superadmin
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-4">
                          <p className="text-sm text-muted-foreground">ID: {u.id}</p>
                          <div className="flex items-center gap-6">
                            <p className="text-sm text-blue-500">
                              IP: {u.last_ip}
                            </p>
                            {u.last_login && (
                              <p className="text-sm text-blue-500">
                                Last Login: {format(new Date(u.last_login), "PPpp")}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-2">
                            <Input
                              type="email"
                              placeholder="Email address"
                              value={editingEmails[u.id] ?? u.email ?? ''}
                              onChange={(e) => handleEmailChange(u.id, e.target.value)}
                              className="w-64"
                              disabled={!canModifyUser(u)}
                            />
                            {editingEmails[u.id] !== undefined && canModifyUser(u) && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => saveEmail(u.id)}
                                disabled={updateUserMutation.isPending}
                              >
                                {updateUserMutation.isPending ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Save className="h-4 w-4" />
                                )}
                              </Button>
                            )}
                          </div>
                          {canModifyUser(u) && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => resetPasswordMutation.mutate({ userId: u.id, username: u.username })}
                            >
                              <KeyRound className="h-4 w-4 mr-2" />
                              Reset Password
                            </Button>
                          )}
                          {isSuperAdmin && u.role !== 'superadmin' && (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="outline" size="sm">
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete User</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Are you sure you want to delete {u.username}? This action cannot be undone.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => deleteUserMutation.mutate(u.id)}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  >
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                        </div>
                        {tempPasswords[u.id] && (
                          <p className="text-sm text-muted-foreground">
                            Temporary password: <code className="bg-muted px-1 py-0.5 rounded">{tempPasswords[u.id]}</code>
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-4">
                        {u.role !== 'superadmin' && canModifyUser(u) && (
                          <>
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={!u.approved}
                                onCheckedChange={(checked) =>
                                  updateUserMutation.mutate({ id: u.id, approved: !checked })
                                }
                                disabled={!canModifyUser(u)}
                              />
                              <Label>Account Disabled</Label>
                            </div>
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={u.can_view_nsfw}
                                onCheckedChange={(checked) =>
                                  updateUserMutation.mutate({ id: u.id, can_view_nsfw: checked })
                                }
                                disabled={!canModifyUser(u)}
                              />
                              <Label>NSFW Access</Label>
                            </div>
                            <Select
                              value={u.role}
                              onValueChange={(value) =>
                                updateUserMutation.mutate({ id: u.id, role: value })
                              }
                              disabled={!canModifyUser(u)}
                            >
                              <SelectTrigger className="w-32">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="admin">Admin</SelectItem>
                                <SelectItem value="user">User</SelectItem>
                                <SelectItem value="pending">Pending</SelectItem>
                              </SelectContent>
                            </Select>
                          </>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
          </div>
        </main>
      </div>

      {/* Password Reset Dialog */}
      <Dialog open={passwordDialog.open} onOpenChange={(open) => {
        setPasswordDialog(prev => ({ ...prev, open }));
        if (!open) {
          setCopiedPassword(false);
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Temporary Password Generated</DialogTitle>
            <DialogDescription>
              A temporary password has been generated for <strong>{passwordDialog.username}</strong>.
              {passwordDialog.emailSent && " An email has also been sent to the user."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center space-x-2">
            <div className="grid flex-1 gap-2">
              <Label htmlFor="password" className="sr-only">
                Password
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="password"
                  value={passwordDialog.password}
                  readOnly
                  className="font-mono"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(passwordDialog.password);
                    setCopiedPassword(true);
                    setTimeout(() => setCopiedPassword(false), 2000);
                  }}
                >
                  {copiedPassword ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          </div>
          <div className="text-sm text-muted-foreground">
            The user will be prompted to change this password on their next login.
          </div>
        </DialogContent>
      </Dialog>
    </PageTransition>
  );
}