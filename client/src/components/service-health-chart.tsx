import { useRef } from "react";

interface ServiceHealthChartProps {
  serviceId: number;
  onlineColor: string;
  offlineColor: string;
  timeScale: string;
}

// Simplified health chart component - uptime logging removed
export function ServiceHealthChart({ serviceId, onlineColor, offlineColor, timeScale }: ServiceHealthChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={containerRef} className="h-6 flex items-center justify-center">
      <div className="bg-muted h-1 w-full rounded-full overflow-hidden">
        <div 
          className="h-full rounded-full transition-all duration-500" 
          style={{ 
            width: '100%', 
            backgroundColor: onlineColor 
          }}
        />
      </div>
    </div>
  );
}