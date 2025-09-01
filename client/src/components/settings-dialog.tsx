import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { NavIconButton } from "@/components/ui/nav-icon-button";
import { Settings as SettingsIcon } from "lucide-react";
import { Settings } from "@shared/schema";

interface SettingsDialogProps {
  children?: React.ReactNode;
}

export function SettingsDialog({ children }: SettingsDialogProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        {children || (
          <NavIconButton>
            <SettingsIcon className="h-4 w-4" />
          </NavIconButton>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        {/* Settings content will be added back after verifying the button styling */}
      </DialogContent>
    </Dialog>
  );
}