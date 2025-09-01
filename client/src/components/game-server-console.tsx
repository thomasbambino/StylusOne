import { GameServer } from "@shared/schema";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  Terminal,
  AlertCircle,
  Send
} from "lucide-react";
import { useState } from "react";

interface GameServerConsoleProps {
  server: GameServer;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GameServerConsole({ server, open, onOpenChange }: GameServerConsoleProps) {
  const [command, setCommand] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSendCommand = async () => {
    if (!command.trim()) return;
    
    setIsLoading(true);
    try {
      const response = await fetch(`/api/game-servers/${server.instanceId}/console`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ command: command.trim() }),
      });

      if (!response.ok) {
        throw new Error("Failed to send command");
      }

      setCommand("");
    } catch (error) {
      console.error("Error sending console command:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendCommand();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[600px] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Terminal className="h-5 w-5" />
            Console - {server.name}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 flex flex-col gap-4">
          {/* Console Output Area */}
          <Card className="flex-1">
            <CardContent className="p-4 h-full">
              <div className="h-full bg-black text-green-400 font-mono text-sm rounded p-4 overflow-y-auto">
                <div className="text-gray-400">
                  Console output will be displayed here.
                </div>
                <div className="text-yellow-400 mt-2">
                  Note: Real-time console functionality is being implemented.
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Command Input */}
          <div className="space-y-4">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Console feature is in development. Commands will be sent to the server but output display is not yet implemented.
              </AlertDescription>
            </Alert>

            <div className="flex gap-2">
              <Input
                placeholder="Enter server command..."
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                onKeyPress={handleKeyPress}
                disabled={isLoading}
                className="font-mono"
              />
              <Button
                onClick={handleSendCommand}
                disabled={isLoading || !command.trim()}
                size="sm"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}