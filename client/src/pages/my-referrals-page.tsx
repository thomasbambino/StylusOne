import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Copy, Check, Users, DollarSign, Gift, TrendingUp } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";

interface ReferralCode {
  id: number;
  code: string;
  is_active: boolean;
  created_at: string;
}

interface ReferralStats {
  totalReferrals: number;
  totalCommission: number;
  freeMonthsEarned: number;
  freeMonthsApplied: number;
}

interface Referral {
  id: number;
  referrer_user_id: number;
  referred_user_id: number;
  commission_earned: number;
  free_month_credited: boolean;
  created_at: string;
}

export default function MyReferralsPage() {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const { data: referralCode, isLoading: codeLoading } = useQuery<ReferralCode>({
    queryKey: ["/api/referrals/code"],
  });

  const { data: stats, isLoading: statsLoading } = useQuery<ReferralStats>({
    queryKey: ["/api/referrals/stats"],
  });

  const { data: referrals, isLoading: referralsLoading } = useQuery<Referral[]>({
    queryKey: ["/api/referrals/list"],
  });

  const copyToClipboard = async () => {
    if (!referralCode?.code) return;

    try {
      await navigator.clipboard.writeText(referralCode.code);
      setCopied(true);
      toast({
        title: "Copied!",
        description: "Referral code copied to clipboard",
      });
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to copy referral code",
        variant: "destructive",
      });
    }
  };

  const formatCurrency = (cents: number) => {
    return `$${(cents / 100).toFixed(2)}`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  if (codeLoading || statsLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-6xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2">Referral Program</h1>
        <p className="text-muted-foreground">
          Share your referral code and earn rewards when friends sign up!
        </p>
      </div>

      {/* Referral Code Card */}
      <Card>
        <CardHeader>
          <CardTitle>Your Referral Code</CardTitle>
          <CardDescription>
            Share this code with friends to give them instant access and earn rewards
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex-1 flex items-center gap-2 p-4 bg-muted rounded-lg">
              <code className="text-2xl font-bold tracking-wider flex-1">
                {referralCode?.code || 'Loading...'}
              </code>
              <Button
                onClick={copyToClipboard}
                variant="outline"
                size="sm"
                className="shrink-0"
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 mr-2" />
                    Copy
                  </>
                )}
              </Button>
            </div>
          </div>

          <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <h4 className="font-semibold mb-2 flex items-center gap-2">
              <Gift className="h-5 w-5 text-blue-600" />
              How it works
            </h4>
            <ul className="text-sm space-y-1 text-muted-foreground">
              <li>• Friends who use your code get instant access (no admin approval needed)</li>
              <li>• You earn <strong className="text-foreground">${formatCurrency(500)}</strong> commission per referral</li>
              <li>• You get <strong className="text-foreground">1 free month</strong> off your subscription</li>
              <li>• Track all your referrals and earnings below</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Referrals</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.totalReferrals || 0}</div>
            <p className="text-xs text-muted-foreground">
              Friends who signed up
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Commission Earned</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(stats?.totalCommission || 0)}</div>
            <p className="text-xs text-muted-foreground">
              Total earnings
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Free Months Earned</CardTitle>
            <Gift className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.freeMonthsEarned || 0}</div>
            <p className="text-xs text-muted-foreground">
              Months of free service
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Free Months Applied</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.freeMonthsApplied || 0}</div>
            <p className="text-xs text-muted-foreground">
              {(stats?.freeMonthsEarned || 0) - (stats?.freeMonthsApplied || 0)} pending
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Referrals List */}
      <Card>
        <CardHeader>
          <CardTitle>Your Referrals</CardTitle>
          <CardDescription>
            People who signed up using your referral code
          </CardDescription>
        </CardHeader>
        <CardContent>
          {referralsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : referrals && referrals.length > 0 ? (
            <div className="space-y-2">
              {referrals.map((referral) => (
                <div
                  key={referral.id}
                  className="flex items-center justify-between p-4 border rounded-lg"
                >
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <Users className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">User #{referral.referred_user_id}</p>
                      <p className="text-sm text-muted-foreground">
                        Joined {formatDate(referral.created_at)}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">{formatCurrency(referral.commission_earned)}</p>
                    {referral.free_month_credited && (
                      <Badge variant="secondary" className="mt-1">
                        Free Month Credited
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No referrals yet</p>
              <p className="text-sm mt-1">Share your code to start earning!</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
