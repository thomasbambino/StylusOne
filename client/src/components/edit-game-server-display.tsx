import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { GameServer, updateGameServerSchema } from "@shared/schema";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Settings2 } from "lucide-react";
import * as z from 'zod';

interface EditGameServerDisplayProps {
  server: GameServer;
  isAdmin: boolean;
}

const displaySchema = updateGameServerSchema.extend({
  customName: z.string().optional(),
  customType: z.string().optional(),
  customIcon: z.string().optional(),
});

export function EditGameServerDisplay({ server, isAdmin }: EditGameServerDisplayProps) {
  const { toast } = useToast();
  
  // Only render for admins
  if (!isAdmin) return null;

  const form = useForm({
    resolver: zodResolver(displaySchema),
    defaultValues: {
      id: server.id,
      customName: server.customName || "",
      customType: server.customType || "",
      customIcon: server.customIcon || "",
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: z.infer<typeof displaySchema>) => {
      const res = await apiRequest("PUT", `/api/game-servers/${server.id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/game-servers"] });
      toast({
        title: "Display settings updated",
        description: "The game server display has been customized successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update display",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button 
          variant="ghost" 
          size="icon"
          className="absolute top-2 right-2"
          aria-label="Edit display settings"
        >
          <Settings2 className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Customize Server Display</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
            <FormField
              control={form.control}
              name="customName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Display Name (Optional)</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder={server.name} 
                      {...field} 
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="customType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Game Type (Optional)</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder={server.type} 
                      {...field} 
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="customIcon"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Custom Icon URL (Optional)</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="https://example.com/icon.png" 
                      {...field} 
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <Button 
              type="submit" 
              className="w-full"
              disabled={mutation.isPending}
            >
              Save Changes
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
