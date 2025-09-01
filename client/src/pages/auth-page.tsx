import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertUserSchema } from "@shared/schema";
import { Redirect } from "wouter";
import { Loader2, ServerCog } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Settings } from "@shared/schema";
import * as z from 'zod';
import { useState, useEffect } from 'react';
import { useToast } from "@/hooks/use-toast";
import { GoogleAuthButton } from "@/components/google-auth-button";
import { useLocation } from 'wouter';
import { cn } from "@/lib/utils";
import { AuthPageSkeleton } from "../components/auth-skeleton";

const requestResetSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

const changePasswordSchema = z
  .object({
    newPassword: z.string().min(6, "Password must be at least 6 characters"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

type FormType = 'login' | 'register' | 'reset' | 'change-password';

export default function AuthPage() {
  const { user, loginMutation, registerMutation } = useAuth();
  const [formType, setFormType] = useState<FormType>('login');
  const [location] = useLocation();
  const { toast } = useToast();
  const isPending = new URLSearchParams(window.location.search).get('pending') === 'true';
  const [contentVisible, setContentVisible] = useState(false);

  const { data: settings, isLoading: isSettingsLoading } = useQuery<Settings>({
    queryKey: ["/api/settings"],
  });

  const loginForm = useForm({
    resolver: zodResolver(insertUserSchema.pick({ username: true, password: true })),
    defaultValues: {
      username: "",
      password: ""
    }
  });

  const registerForm = useForm({
    resolver: zodResolver(insertUserSchema.pick({ username: true, password: true, email: true })),
    defaultValues: {
      username: "",
      password: "",
      email: ""
    }
  });

  const resetForm = useForm({
    resolver: zodResolver(requestResetSchema),
    defaultValues: {
      email: ""
    }
  });

  const changePasswordForm = useForm({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: {
      newPassword: "",
      confirmPassword: ""
    }
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      setContentVisible(true);
    }, 150);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  const handleFormTypeChange = (type: FormType) => {
    setFormType(type);
    loginForm.reset();
    registerForm.reset();
    resetForm.reset();
    changePasswordForm.reset();
  };

  const handleLoginSuccess = (data: any) => {
    if (data.requires_password_change) {
      handleFormTypeChange('change-password');
    }
  };

  const handleChangePassword = async (data: z.infer<typeof changePasswordSchema>) => {
    try {
      const response = await fetch("/api/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: data.newPassword }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to change password");
      }

      toast({
        title: "Success",
        description: "Your password has been updated successfully.",
      });

      handleFormTypeChange('login');
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update password",
        variant: "destructive"
      });
    }
  };

  const handleResetPassword = async (data: { email: string }) => {
    try {
      const response = await fetch('/api/request-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: data.email })
      });

      if (!response.ok) {
        throw new Error("Failed to request password reset");
      }

      toast({
        title: "Reset Request Sent",
        description: "If an account exists with this email, you will receive reset instructions.",
      });
      handleFormTypeChange('login');
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to send reset request. Please try again.",
        variant: "destructive"
      });
    }
  };

  if (user && !user.requires_password_change) {
    return <Redirect to="/" />;
  }
  
  // Show skeleton while loading settings
  if (isSettingsLoading) {
    return <AuthPageSkeleton />;
  }

  if (isPending) {
    return (
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Account Pending Approval</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <p className="text-muted-foreground">
                Your account has been created successfully but requires administrator approval before you can access the dashboard.
              </p>
              <p className="text-muted-foreground">
                Please check back later or contact your administrator for more information.
              </p>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  window.location.href = '/auth';
                }}
              >
                Back to Login
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }


  return (
    <div className="fixed inset-0 flex">
      <div className={cn(
        "w-full h-full grid grid-cols-1 md:grid-cols-2 transition-all duration-500 transform",
        contentVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
      )}>
        <div className="flex items-center justify-center p-8 overflow-hidden">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle className="transition-all duration-300">
                Welcome to {settings?.site_title || "Homelab Dashboard"}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {formType === 'login' && (
                <Form {...loginForm}>
                  <form onSubmit={loginForm.handleSubmit((data) => loginMutation.mutate(data, { onSuccess: handleLoginSuccess }))} className="space-y-4">
                    <FormField
                      control={loginForm.control}
                      name="username"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Username or Email</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={loginForm.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Password</FormLabel>
                          <FormControl>
                            <Input type="password" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button type="submit" className="w-full" disabled={loginMutation.isPending}>
                      {loginMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Login
                    </Button>

                    <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t" />
                      </div>
                      <div className="relative flex justify-center text-xs uppercase">
                        <span className="bg-background px-2 text-muted-foreground">
                          Or continue with
                        </span>
                      </div>
                    </div>

                    <GoogleAuthButton />

                    <div className="space-y-2 text-center">
                      <button
                        type="button"
                        onClick={() => handleFormTypeChange('reset')}
                        className="text-sm text-muted-foreground hover:text-primary transition-colors"
                      >
                        Forgot password?
                      </button>
                      <div className="text-sm text-muted-foreground">
                        Don't have an account?{" "}
                        <button
                          type="button"
                          onClick={() => handleFormTypeChange('register')}
                          className="font-medium text-primary hover:underline"
                        >
                          Sign up
                        </button>
                      </div>
                    </div>
                  </form>
                </Form>
              )}

              {formType === 'change-password' && (
                <Form {...changePasswordForm}>
                  <form onSubmit={changePasswordForm.handleSubmit(handleChangePassword)} className="space-y-4">
                    <FormField
                      control={changePasswordForm.control}
                      name="newPassword"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>New Password</FormLabel>
                          <FormControl>
                            <Input type="password" placeholder="Enter new password" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={changePasswordForm.control}
                      name="confirmPassword"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Confirm Password</FormLabel>
                          <FormControl>
                            <Input type="password" placeholder="Confirm new password" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button type="submit" className="w-full">
                      Change Password
                    </Button>
                  </form>
                </Form>
              )}

              {formType === 'register' && (
                <Form {...registerForm}>
                  <form onSubmit={registerForm.handleSubmit((data) => registerMutation.mutate(data))} className="space-y-4">
                    <FormField
                      control={registerForm.control}
                      name="username"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Username</FormLabel>
                          <FormControl>
                            <Input {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={registerForm.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email</FormLabel>
                          <FormControl>
                            <Input type="email" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={registerForm.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Password</FormLabel>
                          <FormControl>
                            <Input type="password" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button type="submit" className="w-full" disabled={registerMutation.isPending}>
                      {registerMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Register
                    </Button>

                    <div className="text-center">
                      <button
                        type="button"
                        onClick={() => handleFormTypeChange('login')}
                        className="text-sm text-muted-foreground hover:text-primary transition-colors"
                      >
                        Already have an account? Login
                      </button>
                    </div>
                  </form>
                </Form>
              )}

              {formType === 'reset' && (
                <Form {...resetForm}>
                  <form onSubmit={resetForm.handleSubmit(handleResetPassword)} className="space-y-4">
                    <FormField
                      control={resetForm.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email Address</FormLabel>
                          <FormControl>
                            <Input type="email" placeholder="Enter your email address" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button type="submit" className="w-full">
                      Reset Password
                    </Button>

                    <div className="text-center">
                      <button
                        type="button"
                        onClick={() => handleFormTypeChange('login')}
                        className="text-sm text-muted-foreground hover:text-primary transition-colors"
                      >
                        Back to Login
                      </button>
                    </div>
                  </form>
                </Form>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="hidden md:flex flex-col items-center justify-center p-8 bg-primary/3 overflow-hidden">
          <div className={cn(
            "flex flex-col items-center transition-all duration-500",
            contentVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
          )}>
            {settings?.logo_url_large ? (
              <img
                src={settings.logo_url_large}
                alt="Site Logo"
                className="h-20 w-20 mb-4 object-contain"
              />
            ) : (
              <ServerCog className="h-20 w-20 mb-4 text-primary" />
            )}
            <h2 className="text-2xl font-bold mb-2">{settings?.site_title || "Homelab Dashboard"}</h2>
            <p className="text-center text-muted-foreground max-w-md">
              {settings?.login_description || "Monitor your services and game servers in real-time with our comprehensive dashboard."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}