import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { useToast } from "@/hooks/use-toast";
import { Plus } from "lucide-react";
import * as z from 'zod';
import { apiRequest } from "@/lib/queryClient";

// List of supported games from the text file
const SUPPORTED_GAMES = [
  "Broke Protocol",
  "Call Of Duty: Modern Warfare 2 (2009)",
  "Call Of Duty: Modern Warfare 3 (2011)",
  "Call Of Duty 4: Modern Warfare",
  "Carrier Command 2",
  "Chivalry: Medieval Warfare",
  "Conan Exiles",
  "Core Keeper",
  "Craftopia",
  "Creativerse",
  "Colony Survival",
  "Counter-Strike 1.6",
  "Counter-Strike 2",
  "Counter-Strike: Condition Zero",
  "Counter-Strike: Global Offensive",
  "Counter-Strike: Source",
  "CryoFall",
  "Day of Defeat: Source",
  "Day Of Dragons",
  "DayZ (Experimental)",
  "DayZ (Stable)",
  "Dead Matter",
  "Don't Starve Together",
  "Dota 2",
  "Eco",
  "Empyrion Galactic Survival",
  "Enshrouded",
  "European Truck Simulator 2",
  "EXFIL",
  "E.Y.E: Divine Cybermancy",
  "Factorio",
  "FOUNDRY",
  "Frozen Flame",
  "Garry's Mod",
  "Ground Branch",
  "Half-Life",
  "Half-Life: Opposing Force",
  "HumanitZ",
  "Hurtworld",
  "Icarus",
  "Impostor (Among Us)",
  "Insurgency Sandstorm",
  "Just Cause 3",
  "Kaboom!",
  "Killing Floor 2",
  "Last Oasis",
  "Left 4 Dead",
  "Left 4 Dead 2",
  "Longvinter",
  "Mindustry",
  "Minecraft Bedrock",
  "Minetest",
  "Mordhau",
  "Mount & Blade II: Bannerlord",
  "Multi Theft Auto: San Andreas",
  "MX Bikes",
  "Myth of Empires",
  "Necesse",
  "Night Of The Dead",
  "No More Room in Hell",
  "No One Survived",
  "OpenRA - Dune 2000",
  "OpenRA - Red Alert",
  "OpenRA - Tiberian Dawn",
  "OpenRCT2",
  "Open World - RimWorld Server",
  "Operation: Harsh Doorstop",
  "Palworld",
  "Path Of Titans",
  "PixARK",
  "Portal Knights",
  "Post Scriptum",
  "Pre-Fortress 2",
  "Project 5: Sightseer",
  "Project Zomboid",
  "Quake III Arena",
  "RAGE:MP - Grand Theft Auto V Server",
  "Reign Of Kings",
  "Rimworld Together - RimWorld Server",
  "Rising Storm 2: Vietnam",
  "Rising World (Unity Version)",
  "Risk Of Rain 2",
  "San Andreas Multiplayer",
  "Sapiens",
  "Satisfactory",
  "SCP: Secret Laboratory",
  "Seven Days To Die",
  "Skyrim Together Reborn",
  "Smalland: Survive the Wilds",
  "Sons Of The Forest",
  "Soulmask",
  "Space Engineers",
  "Squad",
  "STAR WARS Jedi Knight - Jedi Academy",
  "Starbound",
  "Starmade",
  "Stationeers",
  "Staxel",
  "Stormworks",
  "Subnautica (Legacy)",
  "Subsistence",
  "Sunkenland",
  "Sven Co-op",
  "Swords 'n Magic and Stuff",
  "Tarkov (Fika Mod)",
  "Team Fortress 2",
  "Team Fortress Classic",
  "Teeworlds",
  "Terraria",
  "TerraTech Worlds",
  "The Lord of the Rings: Return to Moria",
  "The Forest",
  "The Front",
  "The Isle (Legacy)",
  "The Isle (EVRIMA)",
  "tModLoader (Legacy and 1.4+)",
  "Turbo Sliders Unlimited",
  "Unreal Tournament 2004",
  "Unreal Tournament 99",
  "Unturned",
  "V Rising",
  "Valheim",
  "Veloren",
  "Vintage Story (Legacy and 1.18.8+)",
  "Windward",
  "Wolfenstein: Enemy Territory",
  "Wreckfest",
  "Wurm Unlimited",
  "Xonotic"
].sort();

const requestServerSchema = z.object({
  game: z.string().min(1, "Please select a game"),
});

type RequestServerForm = z.infer<typeof requestServerSchema>;

export function RequestServerDialog() {
  const { toast } = useToast();
  const form = useForm<RequestServerForm>({
    resolver: zodResolver(requestServerSchema),
    defaultValues: {
      game: "",
    },
  });

  const onSubmit = async (data: RequestServerForm) => {
    try {
      await apiRequest("POST", "/api/game-servers/request", data);
      toast({
        title: "Server request submitted",
        description: `Your request for a ${data.game} server has been sent to the administrators.`,
      });
      form.reset();
    } catch (error) {
      toast({
        title: "Failed to submit request",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="h-4 w-4 mr-2" />
          Request Server
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request New Game Server</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="game"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Game</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a game" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {SUPPORTED_GAMES.map((game) => (
                        <SelectItem key={game} value={game}>
                          {game}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )}
            />
            <Button type="submit" className="w-full">
              Submit Request
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}