import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { GameServer, updateGameServerSchema } from "@shared/schema";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ImageUpload } from "@/components/ui/image-upload";
import { Loader2, Play, PowerOff, Trash2, RefreshCw, XCircle } from "lucide-react";
import { useState } from "react";
import { Switch } from "@/components/ui/switch";

const SERVER_TYPES = ["minecraft", "satisfactory", "valheim", "terraria"];

interface EditGameServerDialogProps {
  server: GameServer;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditGameServerDialog({ server, open, onOpenChange }: EditGameServerDialogProps) {
  const { toast } = useToast();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const form = useForm({
    resolver: zodResolver(updateGameServerSchema),
    defaultValues: {
      id: server.id,
      name: server.name,
      type: server.type,
      instanceId: server.instanceId,
      icon: server.icon ?? "",
      background: server.background ?? "",
      refreshInterval: server.refreshInterval ?? 30,
      show_player_count: server.show_player_count ?? false,
      show_status_badge: server.show_status_badge ?? false,
      autoStart: server.autoStart ?? false,
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: Parameters<typeof updateGameServerSchema.parse>[0]) => {
      const res = await apiRequest("PUT", `/api/game-servers/${server.id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/game-servers"] });
      toast({
        title: "Server updated",
        description: "The game server has been updated successfully",
      });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update server",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const startServerMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/game-servers/${server.instanceId}/start`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/game-servers"] });
      toast({
        title: "Server started",
        description: "The game server is starting up",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to start server",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const stopServerMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/game-servers/${server.instanceId}/stop`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/game-servers"] });
      toast({
        title: "Server stopped",
        description: "The game server is shutting down",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to stop server",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const restartServerMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/game-servers/${server.instanceId}/restart`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/game-servers"] });
      toast({
        title: "Server restarting",
        description: "The game server is restarting",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to restart server",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const killServerMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/game-servers/${server.instanceId}/kill`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/game-servers"] });
      toast({
        title: "Server killed",
        description: "The game server has been forcefully stopped",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to kill server",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/game-servers/${server.id}`);
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to delete server: ${errorText}`);
      }
      return true;
    },
    onSuccess: () => {
      setShowDeleteConfirm(false);
      onOpenChange(false);
      queryClient.removeQueries({ queryKey: [`/api/game-servers/${server.id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/game-servers"], refetchType: 'all' });
      toast({
        title: "Server deleted",
        description: "The game server has been deleted successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to delete server",
        description: error.message,
        variant: "destructive",
      });
      setShowDeleteConfirm(false);
    },
  });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          aria-labelledby="edit-server-title"
          aria-describedby="edit-server-description"
        >
          <DialogHeader>
            <DialogTitle id="edit-server-title">Edit Game Server</DialogTitle>
          </DialogHeader>
          <div id="edit-server-description" className="sr-only">
            Edit the settings and appearance of your game server
          </div>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit((data) => updateMutation.mutate(data))}
              className="space-y-4"
              aria-label="Edit game server form"
            >
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel id="server-name-label">Server Name</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        aria-labelledby="server-name-label"
                        aria-required="true"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4" role="group" aria-label="Server connection details">
                {/* This part remains unchanged */}
              </div>
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
              <FormField
                control={form.control}
                name="icon"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel id="server-icon-label">Icon Image</FormLabel>
                    <FormControl>
                      <ImageUpload
                        value={field.value}
                        onChange={field.onChange}
                        onClear={() => field.onChange("")}
                        aria-labelledby="server-icon-label"
                        aria-describedby="server-icon-description"
                        uploadType="service"
                      />
                    </FormControl>
                    <div id="server-icon-description" className="sr-only">
                      Upload or select an icon image for your game server
                    </div>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="background"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel id="server-bg-label">Background Image</FormLabel>
                    <FormControl>
                      <ImageUpload
                        value={field.value}
                        onChange={field.onChange}
                        onClear={() => field.onChange("")}
                        aria-labelledby="server-bg-label"
                        aria-describedby="server-bg-description"
                        uploadType="service"
                      />
                    </FormControl>
                    <div id="server-bg-description" className="sr-only">
                      Upload or select a background image for your game server
                    </div>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="refreshInterval"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel id="refresh-interval-label">Refresh Interval (seconds)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min="5"
                        {...field}
                        value={field.value ?? ''}
                        onChange={(e) => field.onChange(parseInt(e.target.value) || null)}
                        aria-labelledby="refresh-interval-label"
                        aria-describedby="refresh-interval-description"
                      />
                    </FormControl>
                    <div id="refresh-interval-description" className="sr-only">
                      Set how often the server status should be checked, minimum 5 seconds
                    </div>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="show_player_count"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between space-y-0 rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel>Show Player Count</FormLabel>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="show_status_badge"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between space-y-0 rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel>Show Status Badge</FormLabel>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="autoStart"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between space-y-0 rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel>Auto Start Server</FormLabel>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => startServerMutation.mutate()}
                  disabled={startServerMutation.isPending || !server.instanceId}
                  aria-label="Start server"
                >
                  {startServerMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  Start
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => stopServerMutation.mutate()}
                  disabled={stopServerMutation.isPending || !server.instanceId}
                  aria-label="Stop server"
                >
                  {stopServerMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <PowerOff className="h-4 w-4" />
                  )}
                  Stop
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => restartServerMutation.mutate()}
                  disabled={restartServerMutation.isPending || !server.instanceId}
                  aria-label="Restart server"
                >
                  {restartServerMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  Restart
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => killServerMutation.mutate()}
                  disabled={killServerMutation.isPending || !server.instanceId}
                  aria-label="Kill server"
                >
                  {killServerMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <XCircle className="h-4 w-4" />
                  )}
                  Kill
                </Button>
              </div>
              <div className="flex justify-between gap-4">
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={deleteMutation.isPending}
                  aria-label="Delete server"
                >
                  <Trash2 className="h-4 w-4 mr-2" aria-hidden="true" />
                  Delete Server
                </Button>
                <Button
                  type="submit"
                  className="flex-1"
                  disabled={updateMutation.isPending}
                  aria-label={updateMutation.isPending ? "Saving changes..." : "Save changes"}
                >
                  {updateMutation.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  )}
                  Save Changes
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure you want to delete this server?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the game server
              "{server.name}" and remove all of its data from our servers.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                deleteMutation.mutate();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete Server"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}