import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface TimeScaleSelectorProps {
  value: string;
  onValueChange: (value: string) => void;
}

export function TimeScaleSelector({ value, onValueChange }: TimeScaleSelectorProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">Time Scale:</span>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className="w-24">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="1h">1 hour</SelectItem>
          <SelectItem value="6h">6 hours</SelectItem>
          <SelectItem value="12h">12 hours</SelectItem>
          <SelectItem value="24h">24 hours</SelectItem>
          <SelectItem value="1w">1 week</SelectItem>
          <SelectItem value="1m">1 month</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
