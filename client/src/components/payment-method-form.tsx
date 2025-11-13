import { useState } from 'react';
import { PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

interface PaymentMethodFormProps {
  onSuccess?: ((paymentMethodId: string) => void) | (() => void);
  submitButtonText?: string;
  isLoading?: boolean;
}

export function PaymentMethodForm({ onSuccess, submitButtonText = 'Save Payment Method', isLoading: externalLoading }: PaymentMethodFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isProcessing, setIsProcessing] = useState(false);

  const updatePaymentMethodMutation = useMutation({
    mutationFn: async (paymentMethodId: string) => {
      const res = await fetch('/api/subscriptions/payment-method', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_method_id: paymentMethodId }),
      });
      if (!res.ok) throw new Error('Failed to update payment method');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/subscriptions/payment-methods'] });
      toast({
        title: 'Success',
        description: 'Payment method updated successfully',
      });
      if (onSuccess) {
        onSuccess();
      }
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setIsProcessing(true);

    try {
      const { error: submitError } = await elements.submit();
      if (submitError) {
        throw new Error(submitError.message);
      }

      // Create payment method
      const { error, paymentMethod } = await stripe.createPaymentMethod({
        elements,
      });

      if (error) {
        throw new Error(error.message);
      }

      if (paymentMethod) {
        // If onSuccess accepts a parameter, call it with payment method ID (for new subscriptions)
        // Otherwise, call the update endpoint (for updating existing payment methods)
        if (onSuccess && onSuccess.length > 0) {
          onSuccess(paymentMethod.id);
        } else {
          await updatePaymentMethodMutation.mutateAsync(paymentMethod.id);
        }
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to process payment method',
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const loading = isProcessing || externalLoading || false;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />

      <Button
        type="submit"
        disabled={!stripe || loading}
        className="w-full"
      >
        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {loading ? 'Processing...' : submitButtonText}
      </Button>
    </form>
  );
}
