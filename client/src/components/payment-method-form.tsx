import { useState } from 'react';
import { CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';

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
      const res = await apiRequest('POST', '/api/subscriptions/payment-method', {
        payment_method_id: paymentMethodId,
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

    const cardElement = elements.getElement(CardElement);
    if (!cardElement) {
      return;
    }

    setIsProcessing(true);

    try {
      // Create payment method with card element
      const { error, paymentMethod } = await stripe.createPaymentMethod({
        type: 'card',
        card: cardElement,
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

  const cardElementOptions = {
    style: {
      base: {
        fontSize: '16px',
        color: '#000000',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        '::placeholder': {
          color: '#9CA3AF',
        },
      },
      invalid: {
        color: '#EF4444',
      },
    },
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="p-4 border rounded-md bg-white" style={{ minHeight: '40px' }}>
        <CardElement options={cardElementOptions} />
      </div>

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
