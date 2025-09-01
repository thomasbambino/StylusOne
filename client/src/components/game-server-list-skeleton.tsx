import { Skeleton } from "../components/ui/skeleton";
import { cn } from "../lib/utils";

export function GameServerCardSkeleton() {
  return (
    <div className="h-full rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex justify-between items-start mb-3">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-md" />
          <div>
            <Skeleton className="h-5 w-32 mb-1" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
        <Skeleton className="h-6 w-6 rounded-full" />
      </div>
      <div className="space-y-3 mt-4">
        <div className="flex justify-between items-center">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-16" />
        </div>
        <Skeleton className="h-2 w-full rounded-sm" />
        <div className="flex justify-between items-center">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-24 rounded-md" />
        </div>
      </div>
    </div>
  );
}

interface GameServerListSkeletonProps {
  count?: number;
  className?: string;
}

export function GameServerListSkeleton({ count = 6, className }: GameServerListSkeletonProps) {
  return (
    <div className="space-y-6">
      <div className="space-y-4">
        {/* Title and Controls (for visual placeholder) */}
        <div className="flex justify-between items-center">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-8 w-20 rounded-md" />
        </div>
        
        {/* Grid of servers */}
        <div className={cn("grid gap-4 md:grid-cols-2 lg:grid-cols-3", className)}>
          {Array.from({ length: count }).map((_, i) => (
            <div key={i} className="min-h-[200px]">
              <GameServerCardSkeleton />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}