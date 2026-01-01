import { useState, useRef, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Tv, Check, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/use-auth';
import { Redirect } from 'wouter';
import { apiRequest } from '@/lib/queryClient';

export default function TvCodePage() {
  const { user, isLoading: authLoading } = useAuth();
  const [code, setCode] = useState(['', '', '', '', '']);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Focus first input on mount
  useEffect(() => {
    if (inputRefs.current[0]) {
      inputRefs.current[0].focus();
    }
  }, []);

  const verifyMutation = useMutation({
    mutationFn: async (codeString: string) => {
      const res = await apiRequest('POST', '/api/tv-codes/verify', { code: codeString });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Failed to verify code');
      }
      return res.json();
    },
    onSuccess: () => {
      setSuccess(true);
      setError(null);
    },
    onError: (err: Error) => {
      setError(err.message);
      // Clear the inputs on error
      setCode(['', '', '', '', '']);
      if (inputRefs.current[0]) {
        inputRefs.current[0].focus();
      }
    },
  });

  const handleInputChange = (index: number, value: string) => {
    // Only accept alphanumeric characters
    const char = value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(-1);

    const newCode = [...code];
    newCode[index] = char;
    setCode(newCode);
    setError(null);

    // Auto-advance to next input
    if (char && index < 4) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all 5 characters entered
    if (char && index === 4) {
      const fullCode = [...newCode.slice(0, 4), char].join('');
      if (fullCode.length === 5) {
        verifyMutation.mutate(fullCode);
      }
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    // Handle backspace
    if (e.key === 'Backspace') {
      if (!code[index] && index > 0) {
        // Move to previous input if current is empty
        inputRefs.current[index - 1]?.focus();
        const newCode = [...code];
        newCode[index - 1] = '';
        setCode(newCode);
      } else {
        // Clear current input
        const newCode = [...code];
        newCode[index] = '';
        setCode(newCode);
      }
      e.preventDefault();
    }

    // Handle arrow keys
    if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
    if (e.key === 'ArrowRight' && index < 4) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);

    if (pasted.length > 0) {
      const newCode = [...code];
      for (let i = 0; i < 5; i++) {
        newCode[i] = pasted[i] || '';
      }
      setCode(newCode);

      // Focus last filled input or next empty
      const lastIndex = Math.min(pasted.length, 4);
      inputRefs.current[lastIndex]?.focus();

      // Auto-submit if 5 characters pasted
      if (pasted.length === 5) {
        verifyMutation.mutate(pasted);
      }
    }
  };

  // Show loading while checking auth
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // Redirect to auth if not logged in
  if (!user) {
    return <Redirect to="/auth" />;
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="bg-card rounded-xl shadow-lg p-8 text-center">
          <div className="mb-6">
            <Tv className="w-16 h-16 mx-auto text-primary mb-4" />
            <h1 className="text-2xl font-bold text-foreground">Link Your TV</h1>
            <p className="text-muted-foreground mt-2">
              Enter the 5-character code shown on your TV
            </p>
          </div>

          <AnimatePresence mode="wait">
            {success ? (
              <motion.div
                key="success"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="py-8"
              >
                <div className="w-20 h-20 mx-auto bg-green-500/20 rounded-full flex items-center justify-center mb-4">
                  <Check className="w-10 h-10 text-green-500" />
                </div>
                <h2 className="text-xl font-semibold text-foreground mb-2">
                  TV Linked Successfully!
                </h2>
                <p className="text-muted-foreground">
                  You can now close this page. Your TV should be signed in automatically.
                </p>
              </motion.div>
            ) : (
              <motion.div
                key="form"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                {/* Code Input Boxes */}
                <div className="flex justify-center gap-2 mb-6">
                  {code.map((char, index) => (
                    <Input
                      key={index}
                      ref={(el) => (inputRefs.current[index] = el)}
                      type="text"
                      maxLength={1}
                      value={char}
                      onChange={(e) => handleInputChange(index, e.target.value)}
                      onKeyDown={(e) => handleKeyDown(index, e)}
                      onPaste={handlePaste}
                      className={`w-14 h-16 text-center text-2xl font-bold uppercase
                        ${error ? 'border-red-500 focus:ring-red-500' : ''}
                      `}
                      disabled={verifyMutation.isPending}
                      autoComplete="off"
                    />
                  ))}
                </div>

                {/* Error Message */}
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center justify-center gap-2 text-red-500 mb-4"
                  >
                    <AlertCircle className="w-4 h-4" />
                    <span className="text-sm">{error}</span>
                  </motion.div>
                )}

                {/* Loading State */}
                {verifyMutation.isPending && (
                  <div className="flex items-center justify-center gap-2 text-muted-foreground mb-4">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm">Verifying code...</span>
                  </div>
                )}

                {/* Manual Submit Button */}
                <Button
                  onClick={() => verifyMutation.mutate(code.join(''))}
                  disabled={code.join('').length !== 5 || verifyMutation.isPending}
                  className="w-full"
                >
                  {verifyMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Verifying...
                    </>
                  ) : (
                    'Link TV'
                  )}
                </Button>

                <p className="text-xs text-muted-foreground mt-4">
                  The code will auto-submit when you enter all 5 characters
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* User Info */}
        <p className="text-center text-sm text-muted-foreground mt-4">
          Signed in as <span className="font-medium">{user.username}</span>
        </p>
      </motion.div>
    </div>
  );
}
