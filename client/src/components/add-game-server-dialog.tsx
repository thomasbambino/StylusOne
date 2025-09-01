import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertGameServerSchema } from "@shared/schema";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Plus } from "lucide-react";
import * as z from 'zod';

const SERVER_TYPES = ["minecraft", "satisfactory", "valheim", "terraria"];

export function AddGameServerDialog() {
  const { toast } = useToast();
  const form = useForm({
    resolver: zodResolver(insertGameServerSchema),
    defaultValues: {
      name: "",
      instanceId: "",  // Add this field
      type: "minecraft",
      status: false,
      playerCount: 0,
      maxPlayers: 20,
      info: {},
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: z.infer<typeof insertGameServerSchema>) => {
      const res = await apiRequest("POST", "/api/game-servers", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/game-servers"] });
      toast({
        title: "Server added",
        description: "New game server has been added successfully",
      });
      form.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to add server",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" aria-label="Add new game server">
          <Plus className="h-4 w-4 mr-2" aria-hidden="true" />
          Add Server
        </Button>
      </DialogTrigger>
      <DialogContent aria-labelledby="add-server-title" aria-describedby="add-server-description">
        <DialogHeader>
          <DialogTitle id="add-server-title">Add New Game Server</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form 
            onSubmit={form.handleSubmit((data) => mutation.mutate(data))} 
            className="space-y-4"
            aria-label="Add game server form"
          >
            <FormField
              control={form.control}
              name="instanceId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel id="server-instance-label">Instance ID</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="AMP Instance ID" 
                      {...field} 
                      aria-labelledby="server-instance-label"
                      aria-required="true"
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel id="server-name-label">Server Name</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="My Minecraft Server" 
                      {...field} 
                      aria-labelledby="server-name-label"
                      aria-required="true"
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel id="server-type-label">Server Type</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                    aria-labelledby="server-type-label"
                  >
                    <FormControl>
                      <SelectTrigger aria-label="Select game type">
                        <SelectValue placeholder="Select a game type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {SERVER_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {type.charAt(0).toUpperCase() + type.slice(1)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="maxPlayers"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel id="max-players-label">Max Players</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        {...field}
                        onChange={(e) => field.onChange(parseInt(e.target.value))}
                        aria-labelledby="max-players-label"
                        aria-required="true"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>
            <Button 
              type="submit" 
              className="w-full" 
              disabled={mutation.isPending}
              aria-label={mutation.isPending ? "Adding server..." : "Add server"}
            >
              Add Server
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}