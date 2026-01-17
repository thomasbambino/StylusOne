import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Tv, Mail, Loader2, Smartphone, UserPlus } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { GoogleAuth } from '@codetrix-studio/capacitor-google-auth';
import { CapacitorHttp } from '@capacitor/core';
import { buildApiUrl } from '@/lib/capacitor';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { useAuth } from '@/hooks/use-auth';
import { Redirect } from 'wouter';
import { Settings } from '@shared/schema';
import { cn } from '@/lib/utils';
import { loggers } from '@/lib/logger';

type AuthView = 'menu' | 'code' | 'email' | 'register' | 'pending';

interface EmailFormData {
  email: string;
  password: string;
}

interface RegisterFormData {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  referralCode: string;
}

interface TvCodeResponse {
  code: string;
  expiresAt: string;
  expiresInSeconds: number;
}

interface TvCodeStatus {
  verified: boolean;
  authToken?: string;
  expiresAt?: string;
}

// Animated background particles
const FloatingParticle = ({ delay, duration, size, left }: { delay: number; duration: number; size: number; left: number }) => (
  <motion.div
    className="absolute rounded-full bg-white/5"
    style={{ width: size, height: size, left: `${left}%` }}
    initial={{ y: '100vh', opacity: 0 }}
    animate={{
      y: '-100vh',
      opacity: [0, 0.5, 0.5, 0],
    }}
    transition={{
      duration,
      delay,
      repeat: Infinity,
      ease: 'linear',
    }}
  />
);

export default function AuthTvPage() {
  const { user } = useAuth();
  const [view, setView] = useState<AuthView>('menu');
  const [focusedButton, setFocusedButton] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingButton, setLoadingButton] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // TV Code state
  const [tvCode, setTvCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number>(0);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // Email form state
  const [emailForm, setEmailForm] = useState<EmailFormData>({ email: '', password: '' });

  // Register form state
  const [registerForm, setRegisterForm] = useState<RegisterFormData>({ username: '', email: '', password: '', confirmPassword: '', referralCode: '' });

  const { data: settings } = useQuery<Settings>({
    queryKey: ["/api/settings"],
  });

  const buttons = [
    { id: 'code', label: 'Sign in with Code', description: 'Use your phone to sign in', icon: Smartphone },
    { id: 'google', label: 'Sign in with Google', description: 'Quick sign in with Google', icon: () => (
      <img src="/google-g-logo.png" alt="Google" className="w-7 h-7" />
    ) },
    { id: 'email', label: 'Sign in with Email', description: 'Enter email and password', icon: Mail },
    { id: 'register', label: 'Create Account', description: 'New user? Sign up here', icon: UserPlus },
  ];

  // Keyboard navigation for TV remote
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (view === 'menu') {
        switch (e.key) {
          case 'ArrowUp':
            e.preventDefault();
            setFocusedButton(prev => Math.max(0, prev - 1));
            break;
          case 'ArrowDown':
            e.preventDefault();
            setFocusedButton(prev => Math.min(buttons.length - 1, prev + 1));
            break;
          case 'Enter':
            e.preventDefault();
            handleButtonSelect(buttons[focusedButton].id);
            break;
        }
      } else if (view === 'code') {
        if (e.key === 'Escape' || e.key === 'Backspace') {
          e.preventDefault();
          cancelCodeLogin();
        }
      } else if (view === 'email' || view === 'register') {
        if (e.key === 'Escape') {
          e.preventDefault();
          setView('menu');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [view, focusedButton, buttons.length]);

  // Update countdown timer
  useEffect(() => {
    if (!expiresAt) return;

    const updateTimer = () => {
      const remaining = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
      setTimeRemaining(remaining);

      if (remaining <= 0) {
        // Code expired, go back to menu
        cancelCodeLogin();
        setError('Code expired. Please try again.');
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  const generateCode = async () => {
    try {
      setIsLoading(true);
      setLoadingButton('code');
      setError(null);

      const response = await CapacitorHttp.post({
        url: buildApiUrl('/api/tv-codes/generate'),
        headers: { 'Content-Type': 'application/json' },
        data: {},
      });

      if (response.status !== 200) {
        throw new Error(response.data?.message || 'Failed to generate code');
      }

      const data = response.data as TvCodeResponse;
      setTvCode(data.code);
      setExpiresAt(new Date(data.expiresAt));
      setView('code');

      // Start polling for verification
      startPolling(data.code);
    } catch (err) {
      loggers.auth.error('Error generating code', { error: err });
      setError(err instanceof Error ? err.message : 'Failed to generate code');
    } finally {
      setIsLoading(false);
      setLoadingButton(null);
    }
  };

  const startPolling = (code: string) => {
    // Poll every 3 seconds
    pollingRef.current = setInterval(async () => {
      try {
        const response = await CapacitorHttp.get({
          url: buildApiUrl(`/api/tv-codes/status/${code}`),
        });

        if (response.status === 200) {
          const status = response.data as TvCodeStatus;

          if (status.verified && status.authToken) {
            // Code verified! Login with the token
            stopPolling();
            await loginWithToken(status.authToken);
          }
        } else if (response.status === 410) {
          // Code expired or used
          stopPolling();
          cancelCodeLogin();
          setError('Code expired or already used');
        }
      } catch (err) {
        loggers.auth.error('Polling error', { error: err });
      }
    }, 3000);
  };

  const stopPolling = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  };

  const loginWithToken = async (authToken: string) => {
    try {
      setIsLoading(true);

      const response = await CapacitorHttp.post({
        url: buildApiUrl('/api/tv-codes/login'),
        headers: { 'Content-Type': 'application/json' },
        data: { authToken },
      });

      if (response.status !== 200) {
        if (response.data?.requiresApproval) {
          setView('pending');
          return;
        }
        throw new Error(response.data?.message || 'Login failed');
      }

      // Success - update user in query cache
      queryClient.setQueryData(["/api/user"], response.data);

      // Redirect to home
      window.location.href = '/';
    } catch (err) {
      loggers.auth.error('Login error', { error: err });
      setError(err instanceof Error ? err.message : 'Login failed');
      setView('menu');
    } finally {
      setIsLoading(false);
    }
  };

  const cancelCodeLogin = () => {
    stopPolling();
    setTvCode(null);
    setExpiresAt(null);
    setView('menu');
  };

  const handleGoogleSignIn = async () => {
    try {
      setIsLoading(true);
      setLoadingButton('google');
      setError(null);

      const result = await GoogleAuth.signIn();

      const response = await CapacitorHttp.post({
        url: buildApiUrl('/api/auth/google'),
        headers: { 'Content-Type': 'application/json' },
        data: { token: result.authentication.idToken },
      });

      if (response.status !== 200) {
        if (response.status === 403 && response.data?.requiresApproval) {
          setView('pending');
          return;
        }
        throw new Error(response.data?.message || 'Authentication failed');
      }

      queryClient.setQueryData(["/api/user"], response.data);
      window.location.href = '/';
    } catch (err) {
      loggers.auth.error('Google sign-in error', { error: err });
      setError(err instanceof Error ? err.message : 'Google sign-in failed');
    } finally {
      setIsLoading(false);
      setLoadingButton(null);
    }
  };

  const handleEmailSignIn = async () => {
    if (!emailForm.email || !emailForm.password) {
      setError('Please enter email and password');
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const response = await CapacitorHttp.post({
        url: buildApiUrl('/api/login'),
        headers: { 'Content-Type': 'application/json' },
        data: { email: emailForm.email, password: emailForm.password },
      });

      if (response.status !== 200) {
        if (response.status === 403 && response.data?.requiresApproval) {
          setView('pending');
          return;
        }
        throw new Error(response.data?.message || 'Invalid email or password');
      }

      queryClient.setQueryData(["/api/user"], response.data);
      window.location.href = '/';
    } catch (err) {
      loggers.auth.error('Email sign-in error', { error: err });
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!registerForm.username || !registerForm.email || !registerForm.password) {
      setError('Please fill in all fields');
      return;
    }

    if (registerForm.password !== registerForm.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (registerForm.password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const response = await CapacitorHttp.post({
        url: buildApiUrl('/api/register'),
        headers: { 'Content-Type': 'application/json' },
        data: {
          username: registerForm.username,
          email: registerForm.email,
          password: registerForm.password,
          referralCode: registerForm.referralCode || undefined,
        },
      });

      if (response.status !== 200 && response.status !== 201) {
        throw new Error(response.data?.message || 'Registration failed');
      }

      // Check if account requires approval
      if (response.data?.requiresApproval || response.data?.role === 'pending') {
        setView('pending');
        return;
      }

      // Auto-login successful
      queryClient.setQueryData(["/api/user"], response.data);
      window.location.href = '/';
    } catch (err) {
      loggers.auth.error('Registration error', { error: err });
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleButtonSelect = (id: string) => {
    switch (id) {
      case 'code':
        generateCode();
        break;
      case 'google':
        handleGoogleSignIn();
        break;
      case 'email':
        setError(null);
        setEmailForm({ email: '', password: '' });
        setView('email');
        break;
      case 'register':
        setError(null);
        setRegisterForm({ username: '', email: '', password: '', confirmPassword: '', referralCode: '' });
        setView('register');
        break;
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Redirect if already logged in
  if (user) {
    return <Redirect to="/" />;
  }

  // Generate particles for background
  const particles = Array.from({ length: 20 }, (_, i) => ({
    delay: Math.random() * 10,
    duration: 15 + Math.random() * 20,
    size: 4 + Math.random() * 8,
    left: Math.random() * 100,
  }));

  return (
    <div className="fixed inset-0 bg-gradient-to-br from-gray-950 via-gray-900 to-black flex flex-col md:flex-row overflow-hidden justify-center">
      {/* Animated background particles */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {particles.map((p, i) => (
          <FloatingParticle key={i} {...p} />
        ))}
      </div>

      {/* Gradient overlays for depth */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/40 pointer-events-none" />

      <AnimatePresence mode="wait">
        {/* Menu View - Responsive Layout */}
        {view === 'menu' && (
          <>
            {/* Sign In Options - Below branding on mobile, left side on desktop */}
            <motion.div
              key="menu-left"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 30 }}
              transition={{ duration: 0.5 }}
              className="w-full md:w-1/2 flex flex-col justify-center px-6 md:pl-16 md:pr-12 z-10 order-2 md:order-1"
            >
              <motion.h2
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="text-2xl md:text-3xl font-bold text-white mb-6 md:mb-8"
              >
                Sign In
              </motion.h2>

              {error && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-red-500/20 border border-red-500/40 rounded-xl px-5 py-3 text-red-400 text-center mb-6 backdrop-blur-sm"
                >
                  {error}
                </motion.div>
              )}

              <div className="flex flex-col gap-3">
                {buttons.map((button, index) => {
                  const Icon = button.icon;
                  const isFocused = focusedButton === index;
                  return (
                    <motion.button
                      key={button.id}
                      initial={{ opacity: 0, x: -30 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.3 + index * 0.1 }}
                      className={cn(
                        "relative flex items-center gap-4 py-4 px-5 rounded-xl text-left transition-all duration-300 overflow-hidden",
                        isFocused
                          ? "bg-white text-gray-900 scale-[1.02] shadow-2xl shadow-white/20"
                          : "bg-white/5 text-white hover:bg-white/10 border border-white/10"
                      )}
                      onFocus={() => setFocusedButton(index)}
                      onClick={() => handleButtonSelect(button.id)}
                      disabled={isLoading}
                    >
                      {/* Glow effect for focused button */}
                      {isFocused && (
                        <motion.div
                          layoutId="buttonGlow"
                          className="absolute inset-0 bg-gradient-to-r from-white via-white to-gray-100"
                          initial={false}
                          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                        />
                      )}

                      {/* Icon container */}
                      <div className={cn(
                        "relative z-10 flex items-center justify-center w-12 h-12 rounded-lg transition-all duration-300",
                        isFocused ? "bg-gray-900/10" : "bg-white/10"
                      )}>
                        {loadingButton === button.id ? (
                          <Loader2 className={cn("w-6 h-6 animate-spin", isFocused ? "text-gray-900" : "text-white")} />
                        ) : (
                          <Icon className={cn("w-6 h-6", isFocused ? "text-gray-900" : "text-white")} />
                        )}
                      </div>

                      {/* Text content */}
                      <div className="relative z-10 flex-1">
                        <span className={cn(
                          "text-lg font-semibold",
                          isFocused ? "text-gray-900" : "text-white"
                        )}>
                          {button.label}
                        </span>
                        <p className={cn(
                          "text-sm",
                          isFocused ? "text-gray-600" : "text-white/50"
                        )}>
                          {button.description}
                        </p>
                      </div>

                      {/* Arrow indicator */}
                      <div className={cn(
                        "relative z-10 w-7 h-7 flex items-center justify-center rounded-full transition-all duration-300",
                        isFocused ? "bg-gray-900/10" : "bg-white/10"
                      )}>
                        <svg
                          className={cn("w-4 h-4", isFocused ? "text-gray-900" : "text-white/50")}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </motion.button>
                  );
                })}
              </div>

              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.7 }}
                className="hidden md:flex text-white/30 text-sm mt-8 items-center gap-3"
              >
                <span className="px-2 py-1 bg-white/10 rounded text-xs">↑↓</span>
                Navigate
                <span className="px-2 py-1 bg-white/10 rounded text-xs">OK</span>
                Select
              </motion.p>
            </motion.div>

            {/* Branding - Above buttons on mobile, right side on desktop */}
            <motion.div
              key="menu-right"
              initial={{ opacity: 0, y: -30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -30 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="w-full md:w-1/2 flex flex-col items-center justify-center pt-8 pb-4 md:py-0 md:pr-16 z-10 md:border-l border-white/5 order-1 md:order-2"
            >
              {/* Decorative glow behind logo */}
              <div className="absolute w-64 h-64 bg-blue-600/10 rounded-full blur-3xl" />

              <div className="relative">
                {settings?.logo_url_large ? (
                  <motion.img
                    src={settings.logo_url_large}
                    alt="Logo"
                    className="h-16 w-16 md:h-20 md:w-20 mb-3 md:mb-5 object-contain drop-shadow-2xl"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.5, delay: 0.3 }}
                  />
                ) : (
                  <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.5, delay: 0.3 }}
                    className="relative mb-3 md:mb-5"
                  >
                    <Tv className="h-16 w-16 md:h-20 md:w-20 text-blue-500 drop-shadow-2xl" />
                    <div className="absolute inset-0 bg-blue-500/30 blur-2xl rounded-full" />
                  </motion.div>
                )}
              </div>

              <motion.h1
                className="text-2xl md:text-3xl font-bold text-white tracking-tight text-center"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
              >
                {settings?.site_title || 'Stylus One'}
              </motion.h1>

              <motion.p
                className="hidden md:block text-base text-white/40 mt-3 text-center max-w-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
              >
                Stream live TV, movies, and more on your big screen
              </motion.p>

              {/* Version footer - hidden on mobile */}
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.8 }}
                className="hidden md:block absolute bottom-8 text-white/20 text-sm"
              >
                {settings?.site_title || 'Stylus One'}
              </motion.p>
            </motion.div>
          </>
        )}

        {/* Code View - Responsive Layout */}
        {view === 'code' && tvCode && (
          <>
            {/* Code Display - Below QR on mobile, left side on desktop */}
            <motion.div
              key="code-left"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 30 }}
              transition={{ duration: 0.4 }}
              className="w-full md:w-1/2 flex flex-col justify-start md:justify-center px-6 md:pl-12 md:pr-8 z-10 order-2 md:order-1"
            >
              <motion.h2
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="text-xl font-bold text-white mb-4"
              >
                Your Code
              </motion.h2>

              {/* Code Display - Smaller */}
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.2 }}
                className="flex gap-2 mb-6"
              >
                {tvCode.split('').map((char, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 + i * 0.08 }}
                    className="relative"
                  >
                    <div className="w-14 h-16 bg-gradient-to-b from-white/15 to-white/5 rounded-lg flex items-center justify-center border border-white/20 shadow-lg shadow-black/30">
                      <span className="text-3xl font-bold text-white">{char}</span>
                    </div>
                  </motion.div>
                ))}
              </motion.div>

              {/* Waiting indicator */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6 }}
                className="flex flex-col gap-2"
              >
                <div className="flex items-center gap-2 px-3 py-2 bg-white/5 rounded-lg border border-white/10 w-fit">
                  <Loader2 className="w-4 h-4 animate-spin text-white/70" />
                  <span className="text-sm text-white/70">Waiting for verification...</span>
                </div>

                <div className="flex items-center gap-2 text-white/40 text-xs">
                  <span className="font-mono">Expires in {formatTime(timeRemaining)}</span>
                </div>
              </motion.div>

              {/* Cancel button */}
              <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.7 }}
                className="mt-6 px-5 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-white text-sm font-medium transition-all duration-300 focus:ring-4 focus:ring-white/30 focus:scale-105 border border-white/10 w-fit"
                onClick={cancelCodeLogin}
              >
                Cancel
              </motion.button>
            </motion.div>

            {/* QR Code and Instructions - Above code on mobile, right side on desktop */}
            <motion.div
              key="code-right"
              initial={{ opacity: 0, y: -30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -30 }}
              transition={{ duration: 0.4, delay: 0.1 }}
              className="w-full md:w-1/2 flex flex-col items-center justify-end md:justify-center pt-16 pb-6 md:py-0 md:pr-12 z-10 md:border-l border-white/5 order-1 md:order-2"
            >
              <div className="absolute w-64 h-64 bg-blue-600/10 rounded-full blur-3xl" />

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="relative text-center"
              >
                {/* QR Code */}
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.3 }}
                  className="bg-white p-3 rounded-xl mb-5 inline-block shadow-2xl"
                >
                  <QRCodeSVG
                    value="https://stylus.services/tvcode"
                    size={140}
                    level="M"
                    bgColor="#ffffff"
                    fgColor="#000000"
                  />
                </motion.div>

                <p className="text-base text-white/60 mb-2">Scan or visit</p>

                <div className="flex items-center justify-center gap-2 mb-4">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                  <p className="text-xl font-bold text-white tracking-wide">
                    stylus.services/tvcode
                  </p>
                </div>

                <p className="text-sm text-white/40 max-w-xs">
                  Sign in and enter the code on the left
                </p>
              </motion.div>

              {/* Version footer */}
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.8 }}
                className="absolute bottom-6 text-white/20 text-xs"
              >
                {settings?.site_title || 'Stylus One'}
              </motion.p>
            </motion.div>
          </>
        )}

        {/* Pending Approval View - Responsive Layout */}
        {view === 'pending' && (
          <>
            {/* Message - Below branding on mobile, left side on desktop */}
            <motion.div
              key="pending-left"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 30 }}
              transition={{ duration: 0.4 }}
              className="w-full md:w-1/2 flex flex-col justify-start md:justify-center px-6 md:pl-16 md:pr-12 z-10 order-2 md:order-1"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
                className="w-16 h-16 mb-6 bg-amber-500/20 rounded-xl flex items-center justify-center border border-amber-500/30"
              >
                <svg className="w-8 h-8 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </motion.div>

              <motion.h2
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="text-3xl font-bold text-amber-400 mb-4"
              >
                Account Pending Approval
              </motion.h2>

              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="text-white/60 text-lg leading-relaxed mb-2"
              >
                Your account has been created but requires administrator approval
                before you can access the app.
              </motion.p>

              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3 }}
                className="text-white/40 text-base"
              >
                Please check back later or contact your administrator.
              </motion.p>

              <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="mt-8 px-6 py-3 bg-white/10 hover:bg-white/20 rounded-lg text-white font-medium transition-all duration-300 focus:ring-4 focus:ring-white/30 focus:scale-105 border border-white/10 w-fit"
                onClick={() => setView('menu')}
              >
                Back to Sign In
              </motion.button>
            </motion.div>

            {/* Branding - Above message on mobile, right side on desktop */}
            <motion.div
              key="pending-right"
              initial={{ opacity: 0, y: -30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -30 }}
              transition={{ duration: 0.4, delay: 0.1 }}
              className="w-full md:w-1/2 flex flex-col items-center justify-end md:justify-center pt-20 pb-6 md:py-0 md:pr-16 z-10 md:border-l border-white/5 order-1 md:order-2"
            >
              <div className="absolute w-80 h-80 bg-amber-600/10 rounded-full blur-3xl" />

              <div className="relative">
                {settings?.logo_url_large ? (
                  <motion.img
                    src={settings.logo_url_large}
                    alt="Logo"
                    className="h-28 w-28 mb-6 object-contain drop-shadow-2xl opacity-50"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 0.5 }}
                    transition={{ duration: 0.5, delay: 0.3 }}
                  />
                ) : (
                  <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.5, delay: 0.3 }}
                    className="relative mb-6"
                  >
                    <Tv className="h-28 w-28 text-white/30 drop-shadow-2xl" />
                  </motion.div>
                )}
              </div>

              <motion.h1
                className="text-4xl font-bold text-white/50 tracking-tight text-center"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
              >
                {settings?.site_title || 'Stylus One'}
              </motion.h1>

              {/* Version footer */}
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.8 }}
                className="absolute bottom-8 text-white/20 text-sm"
              >
                {settings?.site_title || 'Stylus One'}
              </motion.p>
            </motion.div>
          </>
        )}

        {/* Email View - Responsive Layout */}
        {view === 'email' && (
          <>
            {/* Email Form - Below branding on mobile, left side on desktop */}
            <motion.div
              key="email-left"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 30 }}
              transition={{ duration: 0.4 }}
              className="w-full md:w-1/2 flex flex-col justify-center px-6 md:pl-16 md:pr-12 z-10 order-2 md:order-1"
            >
              <motion.h2
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="text-2xl md:text-3xl font-bold text-white mb-6"
              >
                Sign in with Email
              </motion.h2>

              {error && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-red-500/20 border border-red-500/40 rounded-xl px-5 py-3 text-red-400 text-center mb-6 backdrop-blur-sm"
                >
                  {error}
                </motion.div>
              )}

              <div className="flex flex-col gap-4 max-w-sm">
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  <label className="block text-white/60 text-sm mb-2">Email</label>
                  <input
                    type="email"
                    value={emailForm.email}
                    onChange={(e) => setEmailForm(prev => ({ ...prev, email: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleEmailSignIn(); }}
                    placeholder="Enter your email"
                    className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
                    autoComplete="email"
                    autoFocus
                  />
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 }}
                >
                  <label className="block text-white/60 text-sm mb-2">Password</label>
                  <input
                    type="password"
                    value={emailForm.password}
                    onChange={(e) => setEmailForm(prev => ({ ...prev, password: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleEmailSignIn(); }}
                    placeholder="Enter your password"
                    className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
                    autoComplete="current-password"
                  />
                </motion.div>

                <motion.button
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 }}
                  className="mt-2 px-6 py-3 bg-white text-gray-900 rounded-lg font-semibold transition-all duration-300 hover:bg-white/90 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
                  onClick={handleEmailSignIn}
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Signing in...
                    </>
                  ) : (
                    'Sign In'
                  )}
                </motion.button>

                <motion.button
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.5 }}
                  className="px-5 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-white text-sm font-medium transition-all duration-300 border border-white/10"
                  onClick={() => setView('menu')}
                  disabled={isLoading}
                >
                  Back
                </motion.button>
              </div>
            </motion.div>

            {/* Branding - Above form on mobile, right side on desktop */}
            <motion.div
              key="email-right"
              initial={{ opacity: 0, y: -30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -30 }}
              transition={{ duration: 0.4, delay: 0.1 }}
              className="w-full md:w-1/2 flex flex-col items-center justify-center pt-8 pb-4 md:py-0 md:pr-16 z-10 md:border-l border-white/5 order-1 md:order-2"
            >
              <div className="absolute w-64 h-64 bg-blue-600/10 rounded-full blur-3xl" />

              <div className="relative">
                {settings?.logo_url_large ? (
                  <motion.img
                    src={settings.logo_url_large}
                    alt="Logo"
                    className="h-16 w-16 md:h-20 md:w-20 mb-3 object-contain drop-shadow-2xl"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.5, delay: 0.2 }}
                  />
                ) : (
                  <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.5, delay: 0.2 }}
                    className="relative mb-3"
                  >
                    <Mail className="h-16 w-16 md:h-20 md:w-20 text-blue-500 drop-shadow-2xl" />
                    <div className="absolute inset-0 bg-blue-500/30 blur-2xl rounded-full" />
                  </motion.div>
                )}
              </div>

              <motion.h1
                className="text-xl md:text-2xl font-bold text-white tracking-tight text-center"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
              >
                {settings?.site_title || 'Stylus One'}
              </motion.h1>
            </motion.div>
          </>
        )}

        {/* Register View - Responsive Layout */}
        {view === 'register' && (
          <>
            {/* Register Form - Below branding on mobile, left side on desktop */}
            <motion.div
              key="register-left"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 30 }}
              transition={{ duration: 0.4 }}
              className="w-full md:w-1/2 flex flex-col justify-center px-6 md:pl-16 md:pr-12 z-10 order-2 md:order-1"
            >
              <motion.h2
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="text-2xl md:text-3xl font-bold text-white mb-6"
              >
                Create Account
              </motion.h2>

              {error && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-red-500/20 border border-red-500/40 rounded-xl px-5 py-3 text-red-400 text-center mb-6 backdrop-blur-sm"
                >
                  {error}
                </motion.div>
              )}

              <div className="flex flex-col gap-4 max-w-sm">
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  <label className="block text-white/60 text-sm mb-2">Username</label>
                  <input
                    type="text"
                    value={registerForm.username}
                    onChange={(e) => setRegisterForm(prev => ({ ...prev, username: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleRegister(); }}
                    placeholder="Choose a username"
                    className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
                    autoComplete="username"
                    autoFocus
                  />
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.25 }}
                >
                  <label className="block text-white/60 text-sm mb-2">Email</label>
                  <input
                    type="email"
                    value={registerForm.email}
                    onChange={(e) => setRegisterForm(prev => ({ ...prev, email: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleRegister(); }}
                    placeholder="Enter your email"
                    className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
                    autoComplete="email"
                  />
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 }}
                >
                  <label className="block text-white/60 text-sm mb-2">Password</label>
                  <input
                    type="password"
                    value={registerForm.password}
                    onChange={(e) => setRegisterForm(prev => ({ ...prev, password: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleRegister(); }}
                    placeholder="Create a password"
                    className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
                    autoComplete="new-password"
                  />
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.35 }}
                >
                  <label className="block text-white/60 text-sm mb-2">Confirm Password</label>
                  <input
                    type="password"
                    value={registerForm.confirmPassword}
                    onChange={(e) => setRegisterForm(prev => ({ ...prev, confirmPassword: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleRegister(); }}
                    placeholder="Confirm your password"
                    className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
                    autoComplete="new-password"
                  />
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.4 }}
                >
                  <label className="block text-white/60 text-sm mb-2">Referral Code <span className="text-white/40">(optional)</span></label>
                  <input
                    type="text"
                    value={registerForm.referralCode}
                    onChange={(e) => setRegisterForm(prev => ({ ...prev, referralCode: e.target.value.toUpperCase() }))}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleRegister(); }}
                    placeholder="Enter Referral Code"
                    className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-white/30 uppercase"
                    autoComplete="off"
                  />
                </motion.div>

                <motion.button
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.45 }}
                  className="mt-2 px-6 py-3 bg-white text-gray-900 rounded-lg font-semibold transition-all duration-300 hover:bg-white/90 active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
                  onClick={handleRegister}
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Creating account...
                    </>
                  ) : (
                    'Create Account'
                  )}
                </motion.button>

                <motion.button
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.55 }}
                  className="px-5 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-white text-sm font-medium transition-all duration-300 border border-white/10"
                  onClick={() => setView('menu')}
                  disabled={isLoading}
                >
                  Back
                </motion.button>
              </div>
            </motion.div>

            {/* Branding - Above form on mobile, right side on desktop */}
            <motion.div
              key="register-right"
              initial={{ opacity: 0, y: -30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -30 }}
              transition={{ duration: 0.4, delay: 0.1 }}
              className="w-full md:w-1/2 flex flex-col items-center justify-center pt-8 pb-4 md:py-0 md:pr-16 z-10 md:border-l border-white/5 order-1 md:order-2"
            >
              <div className="absolute w-64 h-64 bg-green-600/10 rounded-full blur-3xl" />

              <div className="relative">
                {settings?.logo_url_large ? (
                  <motion.img
                    src={settings.logo_url_large}
                    alt="Logo"
                    className="h-16 w-16 md:h-20 md:w-20 mb-3 object-contain drop-shadow-2xl"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.5, delay: 0.2 }}
                  />
                ) : (
                  <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.5, delay: 0.2 }}
                    className="relative mb-3"
                  >
                    <UserPlus className="h-16 w-16 md:h-20 md:w-20 text-green-500 drop-shadow-2xl" />
                    <div className="absolute inset-0 bg-green-500/30 blur-2xl rounded-full" />
                  </motion.div>
                )}
              </div>

              <motion.h1
                className="text-xl md:text-2xl font-bold text-white tracking-tight text-center"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
              >
                {settings?.site_title || 'Stylus One'}
              </motion.h1>

              <motion.p
                className="hidden md:block text-sm text-white/40 mt-2 text-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
              >
                Join us today
              </motion.p>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
