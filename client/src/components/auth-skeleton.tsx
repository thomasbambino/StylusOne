import { Skeleton } from "../components/ui/skeleton";
import { Card, CardContent, CardHeader } from "../components/ui/card";

export function AuthFormSkeleton() {
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <Skeleton className="h-7 w-48 mb-1" />
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-full" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-full" />
        </div>
        <Skeleton className="h-10 w-full mt-2" />
        <div className="flex justify-between pt-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-28" />
        </div>
      </CardContent>
    </Card>
  );
}

export function AuthPageSkeleton() {
  return (
    <div className="fixed inset-0 flex">
      <div className="w-full h-full grid grid-cols-1 md:grid-cols-2">
        <div className="flex items-center justify-center p-8 overflow-hidden">
          <AuthFormSkeleton />
        </div>
        <div className="hidden md:flex flex-col items-center justify-center p-8 bg-primary/3 overflow-hidden">
          <div className="flex flex-col items-center">
            <Skeleton className="h-20 w-20 rounded-full mb-4" />
            <Skeleton className="h-6 w-48 mb-2" />
            <Skeleton className="h-4 w-64 mb-1" />
            <Skeleton className="h-4 w-56" />
          </div>
        </div>
      </div>
    </div>
  );
}