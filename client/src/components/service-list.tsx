import { Service } from "@shared/schema";
import { ServiceCard } from "./service-card";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";

interface ServiceListProps {
  services: Service[];
}

export function ServiceList({ services }: ServiceListProps) {
  const { user } = useAuth();
  const [orderedServices, setOrderedServices] = useState(() => {
    // Define priority services
    const priorityServices = ['Plex', 'Overseer', 'Open WebUI'];

    // Create a sorted array considering priority services, NSFW content and user's custom order
    const sortedServices = [...services].sort((a, b) => {
      // If user has a custom order, respect it
      if (user?.service_order?.length) {
        const orderMap = new Map(user.service_order.map((id, index) => [id, index]));
        const orderA = orderMap.get(a.id) ?? Infinity;
        const orderB = orderMap.get(b.id) ?? Infinity;
        return orderA - orderB;
      }

      // Check if services are in priority list
      const isPriorityA = priorityServices.indexOf(a.name);
      const isPriorityB = priorityServices.indexOf(b.name);

      // If both are priority services, sort by priority order
      if (isPriorityA !== -1 && isPriorityB !== -1) {
        return isPriorityA - isPriorityB;
      }

      // If only one is a priority service, it should come first
      if (isPriorityA !== -1) return -1;
      if (isPriorityB !== -1) return 1;

      // For regular users without custom order, push NSFW content to the end
      if (a.isNSFW && !b.isNSFW) return 1;
      if (!a.isNSFW && b.isNSFW) return -1;

      // Default to alphabetical sorting
      return a.name.localeCompare(b.name);
    });

    return sortedServices;
  });

  // Add state for admin controls visibility
  const [showAdminControls, setShowAdminControls] = useState(true);
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';

  // Add keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isAdmin && e.ctrlKey && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        setShowAdminControls(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAdmin]);

  const updateOrderMutation = useMutation({
    mutationFn: async (serviceOrder: number[]) => {
      const res = await apiRequest("PATCH", "/api/user", { service_order: serviceOrder });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
    }
  });

  const handleDragEnd = (result: any) => {
    if (!result.destination) return;

    const items = Array.from(orderedServices);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);

    setOrderedServices(items);
    updateOrderMutation.mutate(items.map(service => service.id));
  };

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <Droppable droppableId="services">
        {(provided) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className="flex flex-wrap"
            style={{
              margin: '-0.5rem', // Compensate for item padding
            }}
          >
            {orderedServices.map((service, index) => (
              <Draggable
                key={service.id}
                draggableId={String(service.id)}
                index={index}
              >
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    {...provided.dragHandleProps}
                    className={`w-full md:w-1/2 lg:w-1/3 p-2 transition-all duration-200 ${
                      snapshot.isDragging ? "scale-105 rotate-2 z-50" : ""
                    }`}
                  >
                    <ServiceCard 
                      service={service} 
                      isDragging={snapshot.isDragging} 
                      showAdminControls={showAdminControls}
                    />
                  </div>
                )}
              </Draggable>
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </DragDropContext>
  );
}