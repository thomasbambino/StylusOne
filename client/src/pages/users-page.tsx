import { useQuery, useMutation } from "@tanstack/react-query";
import { User, Settings } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Redirect } from "wouter";
import { KeyRound, Loader2, Save, Shield, Trash2, MoreVertical, CreditCard, UserCog, CheckCircle2, XCircle, Clock } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LoginAttemptsDialog } from "@/components/login-attempts-dialog";
import { format } from 'date-fns';
import { PageTransition } from "@/components/page-transition";
import { Copy, Check } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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
  const [subscriptionDialog, setSubscriptionDialog] = useState<{ open: boolean; userId: number; username: string }>({
    open: false,
    userId: 0,
    username: '',
  });
  const [selectedPlan, setSelectedPlan] = useState<number>(0);
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('monthly');
  const [durationMonths, setDurationMonths] = useState<number>(1);
  const isSuperAdmin = user?.role === 'superadmin';

  const { data: users = [] } = useQuery<any[]>({
    queryKey: ["/api/subscriptions/admin/users"],
  });

  const { data: settings } = useQuery<Settings>({
    queryKey: ["/api/settings"],
  });

  const { data: subscriptionPlans = [] } = useQuery<any[]>({
    queryKey: ["/api/subscriptions/plans"],
  });

  const updateUserMutation = useMutation({
    mutationFn: async (data: { id: number; role?: string; approved?: boolean; can_view_nsfw?: boolean; email?: string; enabled?: boolean }) => {
      const res = await apiRequest("PATCH", `/api/users/${data.id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subscriptions/admin/users"] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/subscriptions/admin/users"] });
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
        setPasswordDialog({
          open: true,
          password: data.tempPassword,
          username: data.username,
          emailSent: data.emailSent
        });
      }
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

  const assignSubscriptionMutation = useMutation({
    mutationFn: async (data: { user_id: number; plan_id: number; billing_period: 'monthly' | 'annual'; duration_months: number }) => {
      const res = await apiRequest("POST", "/api/subscriptions/admin/assign", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subscriptions/admin/users"] });
      toast({
        title: "Subscription assigned",
        description: "User subscription has been updated successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to assign subscription",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const removeSubscriptionMutation = useMutation({
    mutationFn: async (userId: number) => {
      const res = await apiRequest("DELETE", `/api/subscriptions/admin/remove/${userId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subscriptions/admin/users"] });
      toast({
        title: "Subscription removed",
        description: "User subscription has been removed successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to remove subscription",
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

  const openSubscriptionDialog = (userId: number, username: string) => {
    const userWithSub = users.find(u => u.id === userId);
    if (userWithSub?.subscription) {
      setSelectedPlan(userWithSub.subscription.plan_id);
      setBillingPeriod(userWithSub.subscription.billing_period || 'monthly');
    } else {
      setSelectedPlan(subscriptionPlans[0]?.id || 0);
      setBillingPeriod('monthly');
    }
    setDurationMonths(1);
    setSubscriptionDialog({ open: true, userId, username });
  };

  const handleAssignSubscription = async () => {
    if (!selectedPlan) {
      toast({
        title: "Plan required",
        description: "Please select a subscription plan",
        variant: "destructive",
      });
      return;
    }

    await assignSubscriptionMutation.mutateAsync({
      user_id: subscriptionDialog.userId,
      plan_id: selectedPlan,
      billing_period: billingPeriod,
      duration_months: durationMonths,
    });

    setSubscriptionDialog({ open: false, userId: 0, username: '' });
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

  const getStatusBadge = (u: any) => {
    if (!u.approved) {
      return <Badge variant="secondary" className="flex items-center gap-1"><Clock className="h-3 w-3" /> Pending</Badge>;
    }
    if (!u.enabled) {
      return <Badge variant="destructive" className="flex items-center gap-1"><XCircle className="h-3 w-3" /> Disabled</Badge>;
    }
    return <Badge variant="default" className="flex items-center gap-1 bg-green-600"><CheckCircle2 className="h-3 w-3" /> Active</Badge>;
  };

  return (
    <PageTransition>
      <div className="container mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">User Management</h1>
            <p className="text-muted-foreground mt-1">Manage user accounts and permissions</p>
          </div>
          <div className="flex items-center gap-4">
            {isSuperAdmin && <LoginAttemptsDialog />}
          </div>
        </div>

        {/* Settings Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">General Settings</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <Label className="text-sm font-medium">Default role for new users:</Label>
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
            </div>
          </CardContent>
        </Card>

        {/* Users Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Users ({users.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[200px]">User</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Subscription</TableHead>
                    <TableHead>Last Login</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...users]
                    .sort((a, b) => a.id - b.id)
                    .map((u) => (
                      <TableRow key={u.id}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <span>{u.username}</span>
                            {u.role === 'superadmin' && (
                              <Shield className="h-4 w-4 text-blue-500" title="Superadmin" />
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">ID: {u.id}</div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Input
                              type="email"
                              placeholder="Email address"
                              value={editingEmails[u.id] ?? u.email ?? ''}
                              onChange={(e) => handleEmailChange(u.id, e.target.value)}
                              className="h-8 w-full max-w-[200px]"
                              disabled={!canModifyUser(u)}
                            />
                            {editingEmails[u.id] !== undefined && canModifyUser(u) && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => saveEmail(u.id)}
                                disabled={updateUserMutation.isPending}
                                className="h-8 w-8 p-0"
                              >
                                {updateUserMutation.isPending ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Save className="h-4 w-4" />
                                )}
                              </Button>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{getStatusBadge(u)}</TableCell>
                        <TableCell>
                          {u.role !== 'superadmin' && canModifyUser(u) ? (
                            <Select
                              value={u.role}
                              onValueChange={(value) =>
                                updateUserMutation.mutate({
                                  id: u.id,
                                  role: value,
                                  // When changing from pending to user/admin, auto-approve
                                  approved: value !== 'pending' ? true : false
                                })
                              }
                              disabled={!canModifyUser(u)}
                            >
                              <SelectTrigger className="w-32 h-8">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="admin">Admin</SelectItem>
                                <SelectItem value="user">User</SelectItem>
                                <SelectItem value="pending">Pending</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : (
                            <Badge variant="secondary">{u.role}</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {u.subscription ? (
                            <div className="space-y-1">
                              <div className="font-medium text-sm">{u.subscription.plan_name}</div>
                              <div className="text-xs text-muted-foreground">
                                Expires: {format(new Date(u.subscription.current_period_end), "MMM d, yyyy")}
                              </div>
                              <Badge
                                variant={u.subscription.status === 'active' ? 'default' : 'secondary'}
                                className={u.subscription.status === 'active' ? 'bg-green-600' : ''}
                              >
                                {u.subscription.status}
                              </Badge>
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-sm">None</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {u.last_login ? (
                            <div className="space-y-1">
                              <div className="text-sm">{format(new Date(u.last_login), "MMM d, yyyy")}</div>
                              <div className="text-xs text-muted-foreground">{u.last_ip}</div>
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-sm">Never</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openSubscriptionDialog(u.id, u.username)}>
                                <CreditCard className="h-4 w-4 mr-2" />
                                {u.subscription ? 'Update Plan' : 'Assign Plan'}
                              </DropdownMenuItem>
                              {u.subscription && (
                                <DropdownMenuItem
                                  onClick={() => removeSubscriptionMutation.mutate(u.id)}
                                  className="text-destructive"
                                >
                                  <XCircle className="h-4 w-4 mr-2" />
                                  Remove Subscription
                                </DropdownMenuItem>
                              )}
                              {canModifyUser(u) && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onClick={() => resetPasswordMutation.mutate({ userId: u.id, username: u.username })}>
                                    <KeyRound className="h-4 w-4 mr-2" />
                                    Reset Password
                                  </DropdownMenuItem>
                                  {u.role !== 'superadmin' && (
                                    <DropdownMenuItem
                                      onClick={() => updateUserMutation.mutate({ id: u.id, enabled: !u.enabled })}
                                    >
                                      <UserCog className="h-4 w-4 mr-2" />
                                      {u.enabled ? 'Deactivate Account' : 'Activate Account'}
                                    </DropdownMenuItem>
                                  )}
                                  {isSuperAdmin && u.role !== 'superadmin' && (
                                    <DropdownMenuItem
                                      onClick={() => {
                                        if (confirm(`Are you sure you want to delete ${u.username}? This action cannot be undone.`)) {
                                          deleteUserMutation.mutate(u.id);
                                        }
                                      }}
                                      className="text-destructive"
                                    >
                                      <Trash2 className="h-4 w-4 mr-2" />
                                      Delete User
                                    </DropdownMenuItem>
                                  )}
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
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

      {/* Subscription Assignment Dialog */}
      <Dialog open={subscriptionDialog.open} onOpenChange={(open) => {
        setSubscriptionDialog(prev => ({ ...prev, open }));
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {users.find(u => u.id === subscriptionDialog.userId)?.subscription
                ? 'Update Subscription'
                : 'Assign Subscription'}
            </DialogTitle>
            <DialogDescription>
              Manage subscription for <strong>{subscriptionDialog.username}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="plan">Subscription Plan</Label>
              <Select
                value={selectedPlan.toString()}
                onValueChange={(value) => setSelectedPlan(parseInt(value))}
              >
                <SelectTrigger id="plan">
                  <SelectValue placeholder="Select a plan" />
                </SelectTrigger>
                <SelectContent>
                  {subscriptionPlans.map((plan) => (
                    <SelectItem key={plan.id} value={plan.id.toString()}>
                      {plan.name} - ${(billingPeriod === 'monthly' ? plan.price_monthly : plan.price_annual) / 100}/{billingPeriod === 'monthly' ? 'mo' : 'yr'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Billing Period</Label>
              <RadioGroup
                value={billingPeriod}
                onValueChange={(value) => setBillingPeriod(value as 'monthly' | 'annual')}
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="monthly" id="monthly" />
                  <Label htmlFor="monthly" className="cursor-pointer font-normal">Monthly</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="annual" id="annual" />
                  <Label htmlFor="annual" className="cursor-pointer font-normal">Annual</Label>
                </div>
              </RadioGroup>
            </div>

            <div className="space-y-2">
              <Label htmlFor="duration">Duration (months)</Label>
              <Input
                id="duration"
                type="number"
                min="1"
                max="120"
                value={durationMonths}
                onChange={(e) => setDurationMonths(parseInt(e.target.value) || 1)}
              />
              <p className="text-xs text-muted-foreground">
                Subscription will expire in {durationMonths} month{durationMonths !== 1 ? 's' : ''}
              </p>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button
                variant="outline"
                onClick={() => setSubscriptionDialog({ open: false, userId: 0, username: '' })}
              >
                Cancel
              </Button>
              <Button
                onClick={handleAssignSubscription}
                disabled={assignSubscriptionMutation.isPending || !selectedPlan}
              >
                {assignSubscriptionMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Assigning...
                  </>
                ) : (
                  <>Assign Subscription</>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </PageTransition>
  );
}
