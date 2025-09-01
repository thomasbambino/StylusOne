import { Skeleton } from "../components/ui/skeleton";

export function NavigationBarSkeleton() {
  return (
    <div className="fixed top-0 left-0 right-0 z-50">
      <div className="max-w-[1400px] mx-auto px-4 md:px-8 py-4">
        <nav className="w-full flex items-center justify-between rounded-full border bg-background/95 px-4 md:px-8 py-3 md:py-4 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="flex items-center gap-2 md:gap-3">
            <div className="flex items-center gap-2 md:gap-3">
              {/* Logo skeleton */}
              <Skeleton className="h-7 w-7 md:h-9 md:w-9 rounded-full animate-pulse" />
              {/* Site title skeleton */}
              <Skeleton className="h-5 w-[120px] md:w-[180px]" />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 md:gap-4">
            {/* Theme toggle skeleton */}
            <Skeleton className="h-8 w-8 rounded-full" />
            {/* Notification button skeleton */}
            <Skeleton className="h-8 w-8 rounded-full" />
            {/* User dropdown skeleton */}
            <Skeleton className="h-9 w-24 rounded-md" />
          </div>
        </nav>
      </div>
    </div>
  );
}