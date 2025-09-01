import { Skeleton } from "../components/ui/skeleton";
import { GameServerListSkeleton } from "./game-server-list-skeleton";
import { ServiceListSkeleton } from "./service-list-skeleton";

export function DashboardSkeleton() {
  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header with user greeting */}
      <div className="flex justify-between items-center">
        <div>
          <Skeleton className="h-8 w-64 mb-2" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-10 w-32 rounded-md" />
      </div>
      
      {/* Summary cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <div className="p-4 border rounded-lg bg-card">
          <Skeleton className="h-5 w-32 mb-4" />
          <div className="flex justify-between">
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-8 w-24" />
          </div>
        </div>
        <div className="p-4 border rounded-lg bg-card">
          <Skeleton className="h-5 w-32 mb-4" />
          <div className="flex justify-between">
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-8 w-24" />
          </div>
        </div>
        <div className="p-4 border rounded-lg bg-card">
          <Skeleton className="h-5 w-32 mb-4" />
          <div className="flex justify-between">
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-8 w-24" />
          </div>
        </div>
      </div>
      
      {/* Game servers section */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-4 rounded-full" />
          </div>
          <Skeleton className="h-9 w-32 rounded-md" />
        </div>
        <GameServerListSkeleton count={3} />
      </section>
      
      {/* Services section */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-4 rounded-full" />
          </div>
          <Skeleton className="h-9 w-32 rounded-md" />
        </div>
        <ServiceListSkeleton count={3} />
      </section>
    </div>
  );
}