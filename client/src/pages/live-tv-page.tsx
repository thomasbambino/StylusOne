import { useQuery } from "@tanstack/react-query";
import { Settings } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tv, Signal, AlertTriangle, Wifi, WifiOff, Play, Pause, Volume2, VolumeX, Maximize } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import Hls from "hls.js";
import { motion } from "framer-motion";

interface HDHomeRunDevice {
  DeviceID: string;
  LocalIP: string;
  BaseURL: string;
  LineupURL: string;
  FriendlyName: string;
  ModelNumber: string;
  FirmwareName: string;
  FirmwareVersion: string;
  DeviceAuth: string;
  TunerCount: number;
}

interface HDHomeRunChannel {
  GuideNumber: string;
  GuideName: string;
  URL: string;
  HD: boolean;
  Favorite: boolean;
  DRM: boolean;
}

interface HDHomeRunTuner {
  Resource: string;
  InUse: boolean;
  VctNumber: string;
  VctName: string;
  Frequency: number;
  SignalStrengthPercent: number;
  SignalQualityPercent: number;
  SymbolQualityPercent: number;
  NetworkRate: number;
  TargetIP: string;
}

interface HDHomeRunDeviceResponse {
  configured: boolean;
  device?: HDHomeRunDevice;
  message?: string;
}

interface HDHomeRunChannelsResponse {
  configured: boolean;
  channels: HDHomeRunChannel[];
}

interface HDHomeRunTunersResponse {
  configured: boolean;
  tuners: HDHomeRunTuner[];
}

// EPG Program interface
interface EPGProgram {
  title: string;
  episodeTitle?: string;
  description?: string;
  startTime: Date;
  endTime: Date;
  isLive?: boolean;
}

// Channel logos mapping based on Zap2it data  
const CHANNEL_LOGOS: Record<string, string> = {
  // Major networks
  'CBS8SANDIEGO': 'https://zap2it.tmsimg.com/h3/NowShowing/21212/s28711_ll_h15_ab.png', // CBS 8 San Diego (same as KFMB)
  'XHJKTDT': 'https://zap2it.tmsimg.com/h3/NowShowing/68084/s116153_ll_h15_ab.png',
  'XHJKTDT2': 'https://zap2it.tmsimg.com/h3/NowShowing/88217/s15384_ll_h15_ad.png',
  'XHCTTITDT': 'https://zap2it.tmsimg.com/h3/NowShowing/107888/s101096_ll_h15_aa.png',
  'XHCTTITDT4': 'https://zap2it.tmsimg.com/h3/NowShowing/107889/s101096_ll_h15_aa.png',
  'XETV': 'https://zap2it.tmsimg.com/h3/NowShowing/12026/s116152_ll_h15_aa.png',
  'XETVTDT': 'https://zap2it.tmsimg.com/h3/NowShowing/25019/s116152_ll_h15_aa.png',
  'KZTCLD': 'https://zap2it.tmsimg.com/h3/NowShowing/108737/s66281_ll_h15_ab.png',
  'KZTCLD2': 'https://zap2it.tmsimg.com/h3/NowShowing/108738/s56032_ll_h15_ac.png',
  'KFMBDT': 'https://zap2it.tmsimg.com/h3/NowShowing/21212/s28711_ll_h15_ab.png',
  'KFMBDT2': 'https://zap2it.tmsimg.com/h3/NowShowing/73496/s51306_ll_h15_ac.png',
  'KFMBDT3': 'https://zap2it.tmsimg.com/h3/NowShowing/100093/s106838_ll_h9_ad.png',
  'KFMBDT4': 'https://zap2it.tmsimg.com/h3/NowShowing/114211/s91496_ll_h15_ab.png',
  'KFMBDT5': 'https://zap2it.tmsimg.com/h3/NowShowing/114213/s157427_ll_h15_aa.png',
  'KFMBDT6': 'https://zap2it.tmsimg.com/h3/NowShowing/130920/s147367_ll_h15_aa.png',
  'KSDXLD': 'https://zap2it.tmsimg.com/sources/generic/generic_sources_h3.png',
  'KSDXLD2': 'https://zap2it.tmsimg.com/h3/NowShowing/107219/s65064_ll_h15_af.png',
  'KGTVDT': 'https://zap2it.tmsimg.com/h3/NowShowing/20377/s28708_ll_h15_ac.png',
  'KZSDLD': 'https://zap2it.tmsimg.com/h3/NowShowing/113566/s28708_ll_h15_ac.png',
  'KGTVDT2': 'https://zap2it.tmsimg.com/h3/NowShowing/40462/s73067_ll_h15_ab.png',
  'KZSDLD2': 'https://zap2it.tmsimg.com/h3/NowShowing/113568/s73067_ll_h15_ab.png',
  'KGTVDT3': 'https://zap2it.tmsimg.com/h3/NowShowing/92396/s89922_ll_h9_aa.png',
  'KZSDLD3': 'https://zap2it.tmsimg.com/h3/NowShowing/113570/s89922_ll_h9_aa.png',
  'KGTVDT4': 'https://zap2it.tmsimg.com/h3/NowShowing/106657/s89923_ll_h15_ad.png',
  'KZSDLD4': 'https://zap2it.tmsimg.com/h3/NowShowing/113571/s89923_ll_h15_ad.png',
  'KGTVDT5': 'https://zap2it.tmsimg.com/h3/NowShowing/118806/s92091_ll_h15_aa.png',
  'KGTVDT6': 'https://zap2it.tmsimg.com/h3/NowShowing/121400/s175331_ll_h15_aa.png',
  'KGTVDT7': 'https://zap2it.tmsimg.com/h3/NowShowing/130096/s10269_ll_h15_ab.png',
  'XHTJBTDT': 'https://zap2it.tmsimg.com/h3/NowShowing/86764/s116166_ll_h15_aa.png',
  'XHTJBTDT2': 'https://zap2it.tmsimg.com/h3/NowShowing/99838/s116170_ll_h15_aa.png',
  'XEWT': 'https://zap2it.tmsimg.com/h3/NowShowing/12028/s12028_ll_h15_aa.png',
  'XEWTTDT': 'https://zap2it.tmsimg.com/h3/NowShowing/69701/s12028_ll_h15_aa.png',
  'KPBSDT': 'https://zap2it.tmsimg.com/h3/NowShowing/29024/s29024_ll_h15_aa.png',
  'KPBSDT2': 'https://zap2it.tmsimg.com/h3/NowShowing/30697/s30697_ll_h15_aa.png',
  'KPBSDT3': 'https://zap2it.tmsimg.com/h3/NowShowing/49377/s48990_ll_h15_aa.png',
  'KPBSDT4': 'https://zap2it.tmsimg.com/h3/NowShowing/101904/s101364_ll_h15_ac.png',
  'XETVTDT2': 'https://zap2it.tmsimg.com/h3/NowShowing/114271/s116171_ll_h15_aa.png',
  'KBNTCD': 'https://zap2it.tmsimg.com/h3/NowShowing/68070/s11118_ll_h15_ab.png',
  'KBNTCD2': 'https://zap2it.tmsimg.com/h3/NowShowing/75511/s55578_ll_h15_ab.png',
  'KBNTCD3': 'https://zap2it.tmsimg.com/h3/NowShowing/107576/s102148_ll_h15_ab.png',
  'KBNTCD4': 'https://zap2it.tmsimg.com/h3/NowShowing/107577/s97051_ll_h15_ab.png',
  'KBNTCD5': 'https://zap2it.tmsimg.com/h3/NowShowing/122187/s61775_ll_h15_aa.png',
  'XHUAATDT': 'https://zap2it.tmsimg.com/h3/NowShowing/68081/s116151_ll_h15_ac.png',
  'XHTIT': 'https://zap2it.tmsimg.com/h3/NowShowing/36651/s116154_ll_h15_ac.png',
  'XHTITTDT': 'https://zap2it.tmsimg.com/h3/NowShowing/68062/s116154_ll_h15_ac.png',
  'XHTITTDT2': 'https://zap2it.tmsimg.com/h3/NowShowing/108058/s116157_ll_h15_ab.png',
  'KVSDLD': 'https://zap2it.tmsimg.com/sources/generic/generic_sources_h3.png',
  'KVSDLD2': 'https://zap2it.tmsimg.com/h3/NowShowing/88749/s132423_ll_h15_aa.png',
  'XHJK': 'https://zap2it.tmsimg.com/h3/NowShowing/36536/s116153_ll_h15_ab.png',
  'KSDXLP': 'https://zap2it.tmsimg.com/h3/NowShowing/47371/s65064_ll_h15_af.png',
  'XHAS': 'https://zap2it.tmsimg.com/h3/NowShowing/12029/s65064_ll_h15_af.png',
  'XHASTDT': 'https://zap2it.tmsimg.com/h3/NowShowing/64347/s65064_ll_h15_af.png',
  'XHASTDT2': 'https://zap2it.tmsimg.com/h3/NowShowing/74026/s55578_ll_h15_ab.png',
  'K35DGD': 'https://zap2it.tmsimg.com/sources/generic/generic_sources_h3.png',
  'KDTFLD': 'https://zap2it.tmsimg.com/h3/NowShowing/67983/s29058_ll_h15_ab.png',
  'KDTFLD2': 'https://zap2it.tmsimg.com/h3/NowShowing/67986/s11118_ll_h15_ab.png',
  'KDTFLD3': 'https://zap2it.tmsimg.com/h3/NowShowing/67989/GNLZZGG0028Y3ZQ.png',
  'KNSDDT': 'https://zap2it.tmsimg.com/h3/NowShowing/21213/s28717_ll_h15_ad.png',
  'KNSDDT2': 'https://zap2it.tmsimg.com/h3/NowShowing/45740/s78851_ll_h15_ab.png',
  'KNSDDT3': 'https://zap2it.tmsimg.com/h3/NowShowing/63214/s114278_ll_h15_ae.png',
  'KNSDDT4': 'https://zap2it.tmsimg.com/h3/NowShowing/124203/s21484_ll_h15_ac.png',
  'KSKTCD': 'https://zap2it.tmsimg.com/h3/NowShowing/113665/s56032_ll_h15_ac.png',
  'KSKTCD2': 'https://zap2it.tmsimg.com/h3/NowShowing/113666/s82563_ll_h15_ab.png',
  'KSKTCD3': 'https://zap2it.tmsimg.com/sources/generic/generic_sources_h3.png',
  'KSKTCD4': 'https://zap2it.tmsimg.com/h3/NowShowing/113668/s93430_ll_h15_ab.png',
  'KUANLP': 'https://zap2it.tmsimg.com/h3/NowShowing/47025/s10239_ll_h15_ab.png',
  'KUANLD': 'https://zap2it.tmsimg.com/h3/NowShowing/107246/s107246_ll_h15_aa.png',
  'KUANLD2': 'https://zap2it.tmsimg.com/h3/NowShowing/107247/s74299_ll_h15_ab.png',
  'XHDTVTDT': 'https://zap2it.tmsimg.com/h3/NowShowing/65714/s61719_ll_h15_ab.png',
  'XHDTVD2': 'https://zap2it.tmsimg.com/sources/generic/generic_sources_h3.png',
  'KSDYLD': 'https://zap2it.tmsimg.com/h3/NowShowing/70467/s106819_ll_h6_aa.png',
  'KSDYLD2': 'https://zap2it.tmsimg.com/h3/NowShowing/70475/s159206_ll_h15_aa.png',
  'KSDYLD3': 'https://zap2it.tmsimg.com/h3/NowShowing/70493/GNLZZGG0028Y479.png',
  'KSDYLD4': 'https://zap2it.tmsimg.com/sources/generic/generic_sources_h3.png',
  'KUSIDT': 'https://zap2it.tmsimg.com/sources/generic/generic_sources_h3.png',
  'KUSIDT2': 'https://zap2it.tmsimg.com/h3/NowShowing/153180/s119814_ll_h15_ab.png',
  'XHUAA': 'https://zap2it.tmsimg.com/h3/NowShowing/18021/s116169_ll_h15_aa.png',
  'XHUAATDT2': 'https://zap2it.tmsimg.com/h3/NowShowing/115731/s66635_ll_h15_ac.png',
  'KSWBDT': 'https://zap2it.tmsimg.com/h3/NowShowing/24028/s28719_ll_h15_ac.png',
  'KSWBDT2': 'https://zap2it.tmsimg.com/h3/NowShowing/69874/GNLZZGG0028Y4HS.png',
  'KSWBDT3': 'https://zap2it.tmsimg.com/h3/NowShowing/50770/s111043_ll_h15_aa.png',
  'KSWBDT4': 'https://zap2it.tmsimg.com/h3/NowShowing/106580/s18633_ll_h15_ad.png'
};

// Channel List Item Component
interface ChannelListItemProps {
  channel: HDHomeRunChannel;
  selectedChannel: HDHomeRunChannel | null;
  onChannelSelect: (channel: HDHomeRunChannel) => void;
  useChannelProgram: (channelName: string) => any;
}

function ChannelListItem({ channel, selectedChannel, onChannelSelect, useChannelProgram }: ChannelListItemProps) {
  const { data: program, isLoading } = useChannelProgram(channel.GuideName);
  
  const formatTime = (startTime: Date, endTime: Date) => {
    const start = new Date(startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const end = new Date(endTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return `${start} - ${end}`;
  };

  const isSelected = selectedChannel?.GuideNumber === channel.GuideNumber;

  // Direct mapping from HDHomeRun channel numbers to Zap2it logo keys
  const getChannelLogo = (guideNumber: string, guideName: string) => {
    // Primary mapping: HDHomeRun channel number to Zap2it logo key
    const channelToLogoMapping: Record<string, string> = {
      // CBS 8 San Diego (static channel)
      '8.1': 'CBS8SANDIEGO',  // CBS 8 San Diego
      
      // Channel 10 - ABC San Diego (KGTV/KZSDLD)
      '10.1': 'KGTVDT',     // ABC San Diego
      '10.2': 'KGTVDT2',    // Bounce TV
      '10.3': 'KGTVDT3',    // GRIT  
      '10.4': 'KGTVDT4',    // ION Mystery
      '10.5': 'KGTVDT5',    // Laff
      '10.6': 'KGTVDT6',    // Additional ABC subchannel
      '10.7': 'KGTVDT7',    // Additional ABC subchannel
      '10.8': 'KGTVDT',     // Fallback to main ABC
      
      // Channel 15 - PBS San Diego (KPBS)
      '15.1': 'KPBSDT',     // PBS San Diego
      '15.2': 'KPBSDT2',    // PBS World
      '15.3': 'KPBSDT3',    // PBS Create
      '15.4': 'KPBSDT4',    // PBS Kids
      
      // Channel 39 - NBC San Diego (KNSD)
      '39.1': 'KNSDDT',     // NBC San Diego
      '39.2': 'KNSDDT2',    // NBC subchannel
      '39.3': 'KNSDDT3',    // NBC subchannel
      '39.4': 'KNSDDT4',    // NBC subchannel
      
      // Channel 48 - CBS San Diego (KFMB) - Fixed mappings
      '48.1': 'KUANLD',     // Telemundo 20 San Diego
      '48.2': 'KUANLD2',    // Telemundo subchannel
      
      // Channel 50 - Mixed stations - Fixed mappings
      '50.1': 'KSDYLD',     // Azteca América
      '50.3': 'KSDYLD3',    // RetroTV
      '50.5': 'KFMBDT5',    // CBS Dabl
      '50.6': 'KFMBDT6',    // CBS Start TV 
      '50.7': 'KDTFLD2',    // Daystar TV
      
      // Channel 51 - Fixed mappings
      '51.1': 'KUSIDT',     // KUSI San Diego
      '51.2': 'KUSIDT2',    // KUSI subchannel
      
      // Channel 69 - FOX San Diego (KSWB)
      '69.1': 'KSWBDT',     // FOX 5 San Diego
      '69.2': 'KSWBDT2',    // FOX subchannel (Antenna TV maps here)
      '69.3': 'KSWBDT3',    // FOX subchannel (Court TV maps here)
      '69.4': 'KSWBDT4',    // FOX subchannel (ION maps here)
      
      // Channel 151 - KUSI
      '151.1': 'KUSIDT',    // KUSI San Diego
      
      // Channel 169 - Additional KSWB
      '169.1': 'KSWBDT',    // KSWB FOX 5 (duplicate)
    };
    
    // First try direct channel number mapping
    if (channelToLogoMapping[guideNumber]) {
      return channelToLogoMapping[guideNumber];
    }
    
    // Fallback: name-based mapping for special cases
    const nameUpper = guideName.toUpperCase();
    const nameMappings: Record<string, string> = {
      'ANTENNA': 'XHCTTITDT',  // Antenna TV
      'COURTTV': 'KBNTCD',     // Court TV
      'ION': 'KFMBDT4',        // ION Television
      'XETV': 'XETVTDT',       // XETV
      'KDTF': 'KDTFLD',        // Daystar
      'KVSD': 'KVSDLD',        // KVSD
    };
    
    for (const [name, logoKey] of Object.entries(nameMappings)) {
      if (nameUpper.includes(name)) {
        return logoKey;
      }
    }
    
    // Final fallback: extract call sign from standard format
    return guideName.split('-')[0].replace(/[^A-Z0-9]/g, '');
  };

  const logoKey = getChannelLogo(channel.GuideNumber, channel.GuideName);
  const channelLogo = CHANNEL_LOGOS[logoKey];

  return (
    <button
      onClick={() => onChannelSelect(channel)}
      className={cn(
        "flex items-center gap-3 p-2.5 rounded-lg border transition-all hover:shadow-sm text-left w-full",
        isSelected 
          ? "bg-blue-500 text-white hover:bg-blue-600 border-blue-500 shadow-md" 
          : "bg-card border-border hover:bg-accent/50"
      )}
    >
      <div className={cn(
        "flex-shrink-0 w-10 h-10 rounded border flex items-center justify-center overflow-hidden bg-white",
        isSelected
          ? "border-white/30"
          : "border-border"
      )}>
        {channelLogo ? (
          <>
            <img 
              src={channelLogo}
              alt={channel.GuideName}
              className="w-full h-full object-contain"
              loading="eager"
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                target.style.display = 'none';
                const fallback = target.parentElement?.querySelector('.fallback-logo') as HTMLElement;
                if (fallback) {
                  fallback.classList.remove('hidden');
                  fallback.classList.add('flex');
                }
              }}
            />
            <div className={cn(
              "fallback-logo w-full h-full hidden items-center justify-center text-xs font-bold",
              isSelected
                ? "text-blue-500"
                : "text-foreground"
            )}>
              {channel.GuideNumber}
            </div>
          </>
        ) : (
          <div className={cn(
            "w-full h-full flex items-center justify-center text-xs font-bold",
            isSelected
              ? "text-blue-500"
              : "text-foreground"
          )}>
            {channel.GuideNumber}
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <div className={cn(
            "font-bold text-sm",
            isSelected ? "text-white" : "text-foreground"
          )}>
            {channel.GuideNumber}
          </div>
          <div className={cn(
            "font-medium text-sm truncate",
            isSelected ? "text-white/90" : "text-muted-foreground"
          )}>
            {channel.GuideName}
          </div>
          {channel.HD && (
            <div className={cn(
              "inline-block text-[10px] px-1.5 py-0.5 rounded font-medium",
              isSelected
                ? "bg-white/20 text-white"
                : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
            )}>
              HD
            </div>
          )}
          {channel.GuideNumber === "8.1" && (
            <div className={cn(
              "inline-block text-[10px] px-1.5 py-0.5 rounded font-medium",
              isSelected
                ? "bg-white/20 text-white"
                : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
            )}>
              STREAM
            </div>
          )}
        </div>
        
        {/* Program Information */}
        {isLoading ? (
          <div className={cn(
            "text-xs mt-0.5",
            isSelected ? "text-white/60" : "text-muted-foreground"
          )}>
            Loading...
          </div>
        ) : program ? (
          <>
            <div className={cn(
              "text-xs mt-0.5 truncate",
              isSelected ? "text-white/80" : "text-muted-foreground"
            )}>
              {program.title}
              {program.episodeTitle && ` • ${program.episodeTitle}`}
            </div>
            <div className={cn(
              "text-[10px] mt-0.5",
              isSelected ? "text-white/60" : "text-muted-foreground"
            )}>
              {formatTime(program.startTime, program.endTime)}
            </div>
          </>
        ) : null}
      </div>
    </button>
  );
}

interface TunerSession {
  id: string;
  userId: string;
  channelNumber: string;
  tunerId: number;
  startTime: string;
  lastHeartbeat: string;
  streamUrl: string;
  priority: number;
}

interface TunerStatus {
  tuners: Array<{
    id: number;
    inUse: boolean;
    channelNumber?: string;
    sessionIds: string[];
    lastActivity: string;
    failureCount: number;
    status: 'available' | 'busy' | 'failed' | 'maintenance';
  }>;
  activeSessions: TunerSession[];
  queueLength: number;
  channelMapping: Record<string, number>;
}

export default function LiveTVPage() {
  const [selectedChannel, setSelectedChannel] = useState<HDHomeRunChannel | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [showControls, setShowControls] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentSession, setCurrentSession] = useState<TunerSession | null>(null);
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const fullscreenContainerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const playbackTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const { data: settings } = useQuery<Settings>({
    queryKey: ["/api/settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error("Failed to fetch settings");
      return res.json();
    }
  });

  const { data: deviceInfo, isLoading: deviceLoading, error: deviceError } = useQuery<HDHomeRunDeviceResponse>({
    queryKey: ["/api/hdhomerun/devices"],
    queryFn: async () => {
      const res = await fetch("/api/hdhomerun/devices");
      if (!res.ok) throw new Error("Failed to fetch device info");
      return res.json();
    },
    refetchInterval: 30000
  });

  const { data: channelsData, isLoading: channelsLoading } = useQuery<HDHomeRunChannelsResponse>({
    queryKey: ["/api/hdhomerun/channels"],
    queryFn: async () => {
      const res = await fetch("/api/hdhomerun/channels");
      if (!res.ok) throw new Error("Failed to fetch channels");
      return res.json();
    },
    enabled: deviceInfo?.configured === true,
    refetchInterval: 60000
  });

  const { data: tunersData } = useQuery<HDHomeRunTunersResponse>({
    queryKey: ["/api/hdhomerun/tuners"],
    queryFn: async () => {
      const res = await fetch("/api/hdhomerun/tuners");
      if (!res.ok) throw new Error("Failed to fetch tuner status");
      return res.json();
    },
    enabled: deviceInfo?.configured === true,
    refetchInterval: 5000
  });

  // Query for tuner management status
  const { data: tunerStatusData } = useQuery<TunerStatus>({
    queryKey: ["/api/tuner/status"],
    queryFn: async () => {
      const res = await fetch("/api/tuner/status");
      if (!res.ok) throw new Error("Failed to fetch tuner management status");
      return res.json();
    },
    enabled: deviceInfo?.configured === true,
    refetchInterval: 2000
  });

  // Auto-select first channel on load is disabled - users must manually select a channel

  // Fullscreen change event listener
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Aggressively disable video controls
  useEffect(() => {
    const interval = setInterval(() => {
      if (videoRef.current) {
        videoRef.current.controls = false;
        videoRef.current.removeAttribute('controls');
      }
    }, 500);

    return () => clearInterval(interval);
  }, [selectedChannel]);

  // Removed problematic useEffect timeout - using manual timeout management instead

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (hlsRef.current) {
        console.log('🏠 Destroying HLS instance on component unmount');
        console.log('🏠 Unmount stack trace:', new Error().stack);
        hlsRef.current.destroy();
      }
    };
  }, []);

  // Handle custom video controls
  const handlePlayPause = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
        setIsPlaying(false);
      } else {
        videoRef.current.play().then(() => {
          setIsPlaying(true);
        }).catch((error) => {
          console.error('Error playing video:', error);
          setIsPlaying(false);
        });
      }
    }
  };

  const handleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  const handleVolumeChange = (newVolume: number) => {
    if (videoRef.current) {
      videoRef.current.volume = newVolume;
      setVolume(newVolume);
      setIsMuted(newVolume === 0);
    }
  };

  const handleFullscreen = async () => {
    if (!fullscreenContainerRef.current) return;
    
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await fullscreenContainerRef.current.requestFullscreen();
      }
    } catch (error) {
      console.error('Error toggling fullscreen:', error);
    }
  };

  const showControlsTemporarily = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      setShowControls(false);
    }, 3000);
  };

  const handleChannelSelect = async (channel: HDHomeRunChannel) => {
    
    // Prevent multiple simultaneous channel selections
    if (isLoading) {
      return;
    }
    
    try {
      setIsLoading(true);
      setQueuePosition(null);

      // Release current session if exists
      if (currentSession) {
        await releaseCurrentSession();
      }

      setSelectedChannel(channel);

      // Check if this is CBS 8 (static channel)
      if (channel.GuideNumber === "8.1") {
        // CBS 8 doesn't need tuner manager, play directly
        console.log('Playing CBS 8 San Diego directly');
        playStreamDirectly(channel.URL);
        setIsLoading(false);
        return;
      }

      // Request stream through tuner manager for HDHomeRun channels
      console.log('Requesting stream for channel:', channel.GuideNumber);
      const res = await fetch('/api/tuner/request-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelNumber: channel.GuideNumber })
      });

      const data = await res.json();
      console.log('Stream request response:', data);
      
      if (!res.ok) {
        if (data.message === 'All tuners are busy') {
          setQueuePosition(1); // Will be updated by status polling
          throw new Error('All tuners are busy. You have been added to the queue.');
        }
        throw new Error(data.message || 'Failed to request stream');
      }

      const session = data.session as TunerSession;
      setCurrentSession(session);
      
      // Start heartbeat
      startHeartbeat(session.id);
      
      console.log('Stream session:', session);
      console.log('Stream URL:', session.streamUrl);

      // Set a simple 30-second timeout as fallback (not dependent on React state)
      if (playbackTimeoutRef.current) {
        clearTimeout(playbackTimeoutRef.current);
      }
      playbackTimeoutRef.current = setTimeout(() => {
        console.log('30-second fallback timeout - checking if video started');
        // Only release if session still exists and video element shows it's not playing
        if (currentSession && videoRef.current && videoRef.current.paused && videoRef.current.currentTime === 0) {
          console.log('Video never started playing, releasing session as fallback');
          releaseCurrentSession();
        } else {
          console.log('Video appears to be working, keeping session');
        }
      }, 30000);

      // Clear timeout when video starts playing
      const handleCanPlay = () => {
        if (playbackTimeoutRef.current) {
          console.log('Video can play - clearing playback timeout');
          clearTimeout(playbackTimeoutRef.current);
          playbackTimeoutRef.current = null;
        }
      };

      if (videoRef.current) {
        videoRef.current.addEventListener('canplay', handleCanPlay);
      }
      
      if (videoRef.current) {
        const video = videoRef.current;
        
        // Clean up existing HLS instance
        if (hlsRef.current) {
          console.log('🔥 Destroying existing HLS instance for new channel');
          console.log('🔥 Channel cleanup stack trace:', new Error().stack);
          hlsRef.current.destroy();
          hlsRef.current = null;
        }
        
        if (Hls.isSupported()) {
          // Use HLS.js for browsers that support it  
          const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: false,
            backBufferLength: 90,
            liveSyncDurationCount: 1,
            liveMaxLatencyDurationCount: 3,
            maxBufferLength: 20,
            maxMaxBufferLength: 30,
            maxBufferSize: 60 * 1000 * 1000, // 60MB
            maxBufferHole: 0.5,
            fragLoadingTimeOut: 20000,
            manifestLoadingTimeOut: 15000, // 15 second timeout for manifest loading
            debug: true, // Enable HLS.js debug logging
            fragLoadingMaxRetry: 4,
            fragLoadingRetryDelay: 500,
            startFragPrefetch: true,
            testBandwidth: false,
            progressive: true,
          });
          
          hlsRef.current = hls;
          
          hls.on(Hls.Events.MEDIA_ATTACHED, () => {
            console.log('HLS media attached');
          });
          
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            console.log('HLS manifest parsed, starting playback');
            console.log('Video ready state:', video.readyState);
            console.log('Video network state:', video.networkState);
            console.log('Video can play type HLS:', video.canPlayType('application/vnd.apple.mpegurl'));
            
            setIsLoading(false);
            
            // Try to play the video with detailed error handling
            const playPromise = video.play();
            
            if (playPromise !== undefined) {
              playPromise.then(() => {
                console.log('Video started playing successfully');
                setIsPlaying(true);
              }).catch(error => {
                console.error('Video play promise rejected:', error);
                console.error('Error name:', error.name);
                console.error('Error message:', error.message);
                
                // Only release session for genuine fatal errors
                // Don't release for AbortError or autoplay issues since video might still work
                if (error.name === 'NotAllowedError') {
                  console.log('Autoplay blocked - user interaction required');
                } else if (error.name === 'AbortError') {
                  console.log('Video play was aborted - this is usually not fatal, continuing...');
                } else {
                  console.log('Genuine play error - releasing session');
                  releaseCurrentSession();
                }
                setIsLoading(false);
              });
            }
          });
          
          hls.on(Hls.Events.MANIFEST_LOADING, (event, data) => {
            console.log('Loading HLS manifest:', data.url);
            console.log('Video element ready state:', video.readyState);
            console.log('Video element network state:', video.networkState);
          });

          hls.on(Hls.Events.MANIFEST_LOADED, (event, data) => {
            console.log('HLS manifest loaded successfully:', data);
            console.log('Manifest details - levels:', data.levels?.length, 'url:', data.url);
            console.log('Video element after manifest load - ready state:', video.readyState);
          });
          
          hls.on(Hls.Events.LEVEL_LOADING, (event, data) => {
            console.log('HLS level loading:', data);
          });
          hls.on(Hls.Events.LEVEL_LOADED, (event, data) => {
            console.log('HLS level loaded:', data);
          });
          
          hls.on(Hls.Events.FRAG_LOADING, (event, data) => {
            console.log('Loading HLS fragment:', data.frag?.url);
          });

          hls.on(Hls.Events.FRAG_LOADED, (event, data) => {
            console.log('HLS fragment loaded successfully');
          });
          
          hls.on(Hls.Events.ERROR, (event, data) => {
            console.error('HLS error:', data);
            if (data.fatal) {
              switch (data.type) {
                case Hls.ErrorTypes.NETWORK_ERROR:
                  console.log('Fatal network error, trying to recover');
                  hls.startLoad();
                  break;
                case Hls.ErrorTypes.MEDIA_ERROR:
                  console.log('Fatal media error, trying to recover');
                  hls.recoverMediaError();
                  break;
                default:
                  console.log('Fatal error, cannot recover - releasing session');
                  // Release session on fatal errors
                  if (currentSession) {
                    releaseCurrentSession();
                  }
                  console.log('⚠️ Destroying HLS instance due to fatal error');
                  console.log('⚠️ Fatal error stack trace:', new Error().stack);
                  hls.destroy();
                  setIsLoading(false);
                  break;
              }
            }
          });
          
          // Add video event listeners
          video.addEventListener('play', () => {
            console.log('Video play event fired');
            setIsPlaying(true);
          });
          video.addEventListener('pause', () => {
            console.log('Video pause event fired');
            setIsPlaying(false);
          });
          video.addEventListener('volumechange', () => {
            setVolume(video.volume);
            setIsMuted(video.muted);
          });
          video.addEventListener('contextmenu', (e) => e.preventDefault());
          video.addEventListener('loadstart', () => {
            console.log('Video loadstart event');
            video.controls = false;
          });
          video.addEventListener('loadedmetadata', () => {
            console.log('Video loadedmetadata event');
            video.controls = false;
          });
          video.addEventListener('canplay', () => {
            console.log('Video canplay event');
            video.controls = false;
            
            // Try to play again when canplay fires (in case autoplay failed)
            if (video.paused && !isPlaying) {
              console.log('Video is ready, attempting play again');
              video.play().catch(error => {
                console.log('Second play attempt failed:', error.name);
              });
            }
          });
          video.addEventListener('error', (e) => {
            console.error('Video element error:', e);
            console.error('Video error code:', video.error?.code);
            console.error('Video error message:', video.error?.message);
          });


          console.log('Loading HLS source:', session.streamUrl);
          
          // Test direct access to manifest before HLS loading
          console.log('Testing direct manifest access:', session.streamUrl);
          fetch(session.streamUrl)
            .then(response => {
              console.log('Direct fetch success:', response.status, response.statusText);
              console.log('Response headers:', [...response.headers.entries()]);
              return response.text();
            })
            .then(content => {
              console.log('Manifest content preview:', content.substring(0, 200));
            })
            .catch(error => {
              console.error('Direct fetch failed:', error);
            });

          hls.attachMedia(video);
          hls.loadSource(session.streamUrl);
          
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          // Safari has native HLS support
          video.src = session.streamUrl;
          
          const handleLoadedMetadata = () => {
            video.play().then(() => {
              setIsPlaying(true);
              setIsLoading(false);
            }).catch(error => {
              console.error('Error playing video:', error);
              releaseCurrentSession();
              setIsLoading(false);
            });
          };

          const handleError = () => {
            console.error('Safari HLS playback error');
            releaseCurrentSession();
            setIsLoading(false);
          };
          
          video.addEventListener('loadedmetadata', handleLoadedMetadata);
          video.addEventListener('error', handleError);
        } else {
          console.error('HLS is not supported in this browser');
          releaseCurrentSession();
          setIsLoading(false);
        }
      }
    } catch (error) {
      console.error('❌ Error starting stream:', error);
      console.error('❌ Error stack trace:', error.stack);
      console.log('❌ This catch block is releasing the session due to error');
      if (currentSession) {
        await releaseCurrentSession();
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Helper functions for tuner management
  const startHeartbeat = (sessionId: string) => {
    // Clear existing heartbeat
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
    }

    // Send heartbeat every 30 seconds
    heartbeatIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/tuner/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId })
        });

        if (!res.ok) {
          console.error('Failed to send heartbeat');
          clearInterval(heartbeatIntervalRef.current!);
        }
      } catch (error) {
        console.error('Error sending heartbeat:', error);
      }
    }, 30000);
  };

  const releaseCurrentSession = async () => {
    console.log('🚨 releaseCurrentSession called, current session:', currentSession);
    console.log('🚨 Call stack:', new Error().stack);
    if (!currentSession) return;

    try {
      // Stop heartbeat
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }

      // Release session
      const res = await fetch('/api/tuner/release-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: currentSession.id })
      });

      if (!res.ok) {
        console.error('Failed to release session');
      }
    } catch (error) {
      console.error('Error releasing session:', error);
    } finally {
      setCurrentSession(null);
    }
  };

  // Cleanup on unmount and page unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (currentSession) {
        // Use sendBeacon for reliable cleanup on page unload
        const data = JSON.stringify({ sessionId: currentSession.id });
        if (navigator.sendBeacon) {
          navigator.sendBeacon('/api/tuner/release-session', data);
        } else {
          // Fallback for older browsers
          fetch('/api/tuner/release-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: data,
            keepalive: true
          }).catch(console.error);
        }
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && currentSession) {
        // Page is being hidden, stop heartbeat to trigger cleanup
        if (heartbeatIntervalRef.current) {
          clearInterval(heartbeatIntervalRef.current);
          heartbeatIntervalRef.current = null;
        }
      } else if (document.visibilityState === 'visible' && currentSession) {
        // Page is visible again, restart heartbeat
        startHeartbeat(currentSession.id);
      }
    };

    // Add event listeners
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      // Remove event listeners
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      
      // Cleanup resources
      if (hlsRef.current) {
        console.log('💀 FOUND IT! About to destroy HLS in session release');
        console.log('💀 releaseCurrentSession execution stack:', new Error().stack);
        console.log('Destroying HLS instance during session release');
        hlsRef.current.destroy();
      }
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
      if (playbackTimeoutRef.current) {
        console.log('Clearing playback timeout during session release');
        clearTimeout(playbackTimeoutRef.current);
        playbackTimeoutRef.current = null;
      }
      if (currentSession) {
        fetch('/api/tuner/release-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: currentSession.id })
        }).catch(console.error);
      }
    };
  }, []); // Only run on mount/unmount, not when currentSession changes!

  if (deviceLoading) {
    return (
      <div className="min-h-screen bg-background">
          <div className="container mx-auto px-4 ">
          <div className="text-center py-12">
            <div className="inline-flex items-center gap-2">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              <span>Loading HD HomeRun...</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (deviceError || !deviceInfo?.configured) {
    return (
      <div className="min-h-screen bg-background">
          <div className="container mx-auto px-4 ">
          <Alert className="max-w-2xl mx-auto mt-8">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              HD HomeRun is not configured or not accessible. Please check your HDHOMERUN_URL environment variable and ensure your HD HomeRun device is online.
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  // Custom hook to fetch current program for a channel
  const useChannelProgram = (channelName: string) => {
    return useQuery({
      queryKey: ['epg', 'current', channelName],
      queryFn: async () => {
        const response = await fetch(`/api/epg/current/${encodeURIComponent(channelName)}`);
        if (!response.ok) {
          throw new Error('Failed to fetch program data');
        }
        const data = await response.json();
        return data.program as EPGProgram | null;
      },
      staleTime: 5 * 60 * 1000, // 5 minutes
      refetchInterval: 5 * 60 * 1000, // Refetch every 5 minutes
      enabled: !!channelName
    });
  };

  // Current Program component
  function CurrentProgram({ channelName }: { channelName: string }) {
    const { data: program, isLoading } = useChannelProgram(channelName);

    if (isLoading) {
      return <div className="text-sm text-muted-foreground">Loading current show...</div>;
    }

    if (!program) {
      return <div className="text-sm text-muted-foreground">Live Television</div>;
    }

    const formatTime = (startTime: Date, endTime: Date) => {
      const start = new Date(startTime).toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit',
        hour12: true 
      });
      const end = new Date(endTime).toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit',
        hour12: true 
      });
      return `${start} - ${end}`;
    };

    return (
      <div className="text-sm text-muted-foreground">
        <span className="font-medium">{program.title}</span>
        {program.episodeTitle && <span> • {program.episodeTitle}</span>}
        <span className="text-xs ml-2">({formatTime(program.startTime, program.endTime)})</span>
      </div>
    );
  }

  // Add CBS 8 San Diego as a static channel
  const cbs8Channel: HDHomeRunChannel = {
    GuideNumber: "8.1",
    GuideName: "CBS 8 San Diego",
    URL: "https://video.tegnaone.com/kfmb/live/v1/master/f9c1bf9ffd6ac86b6173a7c169ff6e3f4efbd693/KFMB-Production/live/index.m3u8",
    HD: true,
    Favorite: false,
    DRM: false
  };

  // Combine HDHomeRun channels with static CBS 8 channel
  const hdHomeRunChannels = channelsData?.channels?.filter(ch => !ch.DRM) || [];
  const availableChannels = [cbs8Channel, ...hdHomeRunChannels];

  return (
    <motion.div 
      className="min-h-screen bg-background"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.3, ease: "easeInOut" }}
    >
      <motion.div 
        className="container mx-auto px-4 "
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.1 }}
      >
        <div className="max-w-7xl mx-auto space-y-6">

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Video Player Section */}
            <motion.div 
              className="lg:col-span-2"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              {/* Current Channel Info */}
              <Card className="bg-card border">
                <CardHeader className="pb-2 pt-3">
                  {selectedChannel ? (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xl font-bold text-blue-500">{selectedChannel.GuideNumber}</span>
                          {(() => {
                            const getChannelLogo = (guideNumber: string, guideName: string) => {
                              const channelToLogoMapping: Record<string, string> = {
                                '8.1': 'CBS8SANDIEGO',
                                '10.1': 'KGTVDT', '10.2': 'KGTVDT2', '10.3': 'KGTVDT3', '10.4': 'KGTVDT4', '10.5': 'KGTVDT5', '10.6': 'KGTVDT6', '10.7': 'KGTVDT7',
                                '15.1': 'KPBSDT', '15.2': 'KPBSDT2', '15.3': 'KPBSDT3', '15.4': 'KPBSDT4',
                                '39.1': 'KNSDDT', '39.2': 'KNSDDT2', '39.3': 'KNSDDT3', '39.4': 'KNSDDT4',
                                '51.1': 'KFMBDT', '51.2': 'KFMBDT2', '51.3': 'KFMBDT3', '51.4': 'KFMBDT4', '51.5': 'KFMBDT5', '51.6': 'KFMBDT6',
                                '69.1': 'KSWBDT', '69.2': 'KSWBDT2', '69.3': 'KSWBDT3', '69.4': 'KSWBDT4'
                              };
                              if (channelToLogoMapping[guideNumber]) {
                                return channelToLogoMapping[guideNumber];
                              }
                              return guideName.split('-')[0].replace(/[^A-Z0-9]/g, '');
                            };
                            const logoKey = getChannelLogo(selectedChannel.GuideNumber, selectedChannel.GuideName);
                            const channelLogo = CHANNEL_LOGOS[logoKey];
                            return (
                              <div className="h-12 w-12 bg-white rounded flex items-center justify-center overflow-hidden flex-shrink-0">
                                {channelLogo ? (
                                  <img 
                                    src={channelLogo}
                                    alt={selectedChannel.GuideName}
                                    className="w-full h-full object-contain p-1"
                                    loading="eager"
                                    onError={(e) => {
                                      e.currentTarget.style.display = 'none';
                                      e.currentTarget.nextElementSibling?.classList.remove('hidden');
                                    }}
                                  />
                                ) : null}
                                <div className={`p-1.5 rounded bg-gradient-to-br from-blue-500 to-blue-600 ${channelLogo ? 'hidden' : 'flex'}`}>
                                  <Tv className="h-5 w-5 text-white" />
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-lg font-bold truncate">{selectedChannel.GuideName}</div>
                          <CurrentProgram channelName={selectedChannel.GuideName} />
                        </div>
                      </div>
                      {currentSession && (
                        <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-green-500/10 border border-green-500/20 flex-shrink-0">
                          <div className="h-1.5 w-1.5 bg-green-500 rounded-full animate-pulse"></div>
                          <span className="text-xs font-medium text-green-700 dark:text-green-400">Live</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-lg font-bold text-muted-foreground">Select a channel to start watching</div>
                  )}
                </CardHeader>
                <CardContent className="p-0">
                  <div 
                    ref={fullscreenContainerRef}
                    className={cn(
                      "relative bg-black overflow-hidden cursor-pointer",
                      isFullscreen ? "w-full h-full flex items-center justify-center" : "aspect-video rounded-b-lg"
                    )}
                    onMouseMove={showControlsTemporarily}
                    onMouseEnter={() => setShowControls(true)}
                    onMouseLeave={() => !isFullscreen && setShowControls(false)}
                    onClick={handlePlayPause}
                  >
                    <video
                      ref={(el) => {
                        videoRef.current = el;
                        // Video element setup completed
                      }}
                      className={cn(
                        "w-full h-full",
                        isFullscreen && "object-contain"
                      )}
                      autoPlay
                      playsInline
                      {...({ 'webkit-playsinline': 'true' } as any)}
                      muted={false}
                      controls={false}
                      controlsList="nodownload nofullscreen"
                      crossOrigin="anonymous"
                      disablePictureInPicture={false}
                    >
                      Your browser does not support the video tag.
                    </video>

                    {/* Custom Video Controls */}
                    {selectedChannel && (
                      <div className={cn(
                        "absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent",
                        "transition-opacity duration-300",
                        showControls || !isPlaying ? "opacity-100" : "opacity-0"
                      )}>
                        <div className={cn(
                          "absolute flex items-center gap-4",
                          isFullscreen ? "left-8 right-8 bottom-8" : "left-4 right-4 bottom-4"
                        )}>
                          {/* Play/Pause Button */}
                          <button
                            onClick={(e) => { e.stopPropagation(); handlePlayPause(); }}
                            className={cn(
                              "flex items-center justify-center bg-white/20 hover:bg-white/30 rounded-full backdrop-blur-sm transition-colors",
                              isFullscreen ? "w-14 h-14" : "w-12 h-12"
                            )}
                          >
                            {isPlaying ? (
                              <Pause className={cn("text-white", isFullscreen ? "w-7 h-7" : "w-6 h-6")} />
                            ) : (
                              <Play className={cn("text-white ml-1", isFullscreen ? "w-7 h-7" : "w-6 h-6")} />
                            )}
                          </button>

                          {/* Volume Controls */}
                          <div className={cn("flex items-center", isFullscreen ? "gap-3" : "gap-2")}>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleMute(); }}
                              className={cn(
                                "flex items-center justify-center bg-white/20 hover:bg-white/30 rounded-full backdrop-blur-sm transition-colors",
                                isFullscreen ? "w-12 h-12" : "w-10 h-10"
                              )}
                            >
                              {isMuted || volume === 0 ? (
                                <VolumeX className={cn("text-white", isFullscreen ? "w-6 h-6" : "w-5 h-5")} />
                              ) : (
                                <Volume2 className={cn("text-white", isFullscreen ? "w-6 h-6" : "w-5 h-5")} />
                              )}
                            </button>
                            <input
                              type="range"
                              min="0"
                              max="1"
                              step="0.1"
                              value={isMuted ? 0 : volume}
                              onChange={(e) => { e.stopPropagation(); handleVolumeChange(parseFloat(e.target.value)); }}
                              onClick={(e) => e.stopPropagation()}
                              onMouseDown={(e) => e.stopPropagation()}
                              onMouseUp={(e) => e.stopPropagation()}
                              onMouseMove={(e) => e.stopPropagation()}
                              className={cn(
                                "h-2 bg-white/20 rounded-lg appearance-none cursor-pointer slider",
                                isFullscreen ? "w-32" : "w-20"
                              )}
                            />
                          </div>

                          <div className="flex-1" />

                          {/* Fullscreen Button */}
                          <button
                            onClick={(e) => { e.stopPropagation(); handleFullscreen(); }}
                            className={cn(
                              "flex items-center justify-center bg-white/20 hover:bg-white/30 rounded-full backdrop-blur-sm transition-colors",
                              isFullscreen ? "w-12 h-12" : "w-10 h-10"
                            )}
                          >
                            <Maximize className={cn("text-white", isFullscreen ? "w-6 h-6" : "w-5 h-5")} />
                          </button>
                        </div>
                      </div>
                    )}

                    {isLoading && (
                      <div className="absolute inset-0 flex items-center justify-center text-white bg-black/50 backdrop-blur-sm">
                        <div className="text-center">
                          <div className="animate-spin rounded-full h-12 w-12 border-4 border-white border-t-transparent mx-auto mb-3"></div>
                          <p>Loading stream...</p>
                        </div>
                      </div>
                    )}
                    {!selectedChannel && !isLoading && (
                      <div className="absolute inset-0 flex items-center justify-center text-white/60">
                        <div className="text-center">
                          <Tv className="h-12 w-12 mx-auto mb-3" />
                          <p>Select a channel to start watching</p>
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

            </motion.div>

            {/* Channel Lineup */}
            <motion.div 
              className="lg:col-span-1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
            >
              <Card className="bg-card border flex flex-col" style={{ height: '520px' }}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Tv className="h-5 w-5 text-blue-500" />
                      Channel Lineup
                    </CardTitle>
                    <Badge variant="outline">{availableChannels.length} available channels</Badge>
                  </div>
                </CardHeader>
                <CardContent className="p-3 flex flex-col flex-1 min-h-0">
                  {channelsLoading ? (
                    <div className="flex-1 flex items-center justify-center text-muted-foreground">
                      <div className="text-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
                        Loading channels...
                      </div>
                    </div>
                  ) : availableChannels.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center text-muted-foreground">
                      No channels available
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col gap-1.5 overflow-y-auto">
                      {availableChannels.map((channel, index) => (
                        <motion.div
                          key={channel.GuideNumber}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.3, delay: 0.5 + (index * 0.02) }}
                        >
                          <ChannelListItem 
                            channel={channel} 
                            selectedChannel={selectedChannel}
                            onChannelSelect={handleChannelSelect}
                            useChannelProgram={useChannelProgram}
                          />
                        </motion.div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          </div>
          
          {/* Tuner Status - Compact Row Below */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
          >
            <Card className="bg-card border">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Signal className="h-4 w-4 text-blue-500" />
                  <CardTitle className="text-base">TV Tuners</CardTitle>
                </div>
                <Badge variant="outline" className="text-xs">
                  {tunersData?.tuners.length || 0}/{deviceInfo?.device?.TunerCount || 0} tuners
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {tunersData?.tuners?.map((tuner, index) => {
                  const isInUse = tuner.InUse || 
                                  tuner.VctNumber || 
                                  tuner.VctName || 
                                  tuner.Frequency > 0 ||
                                  tuner.TargetIP;
                  
                  return (
                    <motion.div 
                      key={tuner.Resource}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, delay: 0.6 + (index * 0.1) }}
                      className={cn(
                        "p-3 rounded-lg border transition-all duration-300 hover:shadow-sm",
                        isInUse 
                          ? "bg-gradient-to-r from-orange-50 to-red-50 border-orange-200 dark:from-orange-950/20 dark:to-red-950/20 dark:border-orange-800" 
                          : "bg-gradient-to-r from-green-50 to-emerald-50 border-green-200 dark:from-green-950/20 dark:to-emerald-950/20 dark:border-green-800"
                      )}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Tv className={cn(
                            "h-4 w-4",
                            isInUse ? "text-orange-600 dark:text-orange-400" : "text-green-600 dark:text-green-400"
                          )} />
                          <span className="font-semibold text-sm">
                            Tuner {tuner.Resource?.replace('tuner', '')}
                          </span>
                        </div>
                        <Badge 
                          variant="outline" 
                          className={cn(
                            "font-semibold text-xs px-2 py-0.5",
                            isInUse 
                              ? "bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-900/50 dark:text-orange-300 dark:border-orange-700" 
                              : "bg-green-100 text-green-700 border-green-300 dark:bg-green-900/50 dark:text-green-300 dark:border-green-700"
                          )}
                        >
                          {isInUse ? "Active" : "Free"}
                        </Badge>
                      </div>
                      
                      {isInUse ? (
                        <div className="space-y-2">
                          <div className="text-sm font-medium truncate">
                            {tuner.VctNumber ? `Ch ${tuner.VctNumber}` : 'Active'} • {tuner.VctName || 'Unknown'}
                          </div>
                          
                          <div className="flex gap-3 text-xs">
                            {tuner.SignalStrengthPercent > 0 && (
                              <div className="flex-1">
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-muted-foreground font-medium">Signal</span>
                                  <span className="font-semibold">{tuner.SignalStrengthPercent}%</span>
                                </div>
                                <div className="w-full bg-muted rounded-full h-1.5">
                                  <div 
                                    className={cn(
                                      "h-1.5 rounded-full transition-all duration-300",
                                      tuner.SignalStrengthPercent >= 80 ? "bg-green-500" :
                                      tuner.SignalStrengthPercent >= 60 ? "bg-yellow-500" : 
                                      tuner.SignalStrengthPercent >= 40 ? "bg-orange-500" : "bg-red-500"
                                    )}
                                    style={{ width: `${Math.max(tuner.SignalStrengthPercent, 8)}%` }}
                                  />
                                </div>
                              </div>
                            )}
                            
                            {tuner.SignalQualityPercent > 0 && (
                              <div className="flex-1">
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-muted-foreground font-medium">Quality</span>
                                  <span className="font-semibold">{tuner.SignalQualityPercent}%</span>
                                </div>
                                <div className="w-full bg-muted rounded-full h-1.5">
                                  <div 
                                    className={cn(
                                      "h-1.5 rounded-full transition-all duration-300",
                                      tuner.SignalQualityPercent >= 80 ? "bg-green-500" :
                                      tuner.SignalQualityPercent >= 60 ? "bg-yellow-500" : 
                                      tuner.SignalQualityPercent >= 40 ? "bg-orange-500" : "bg-red-500"
                                    )}
                                    style={{ width: `${Math.max(tuner.SignalQualityPercent, 8)}%` }}
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground font-medium">
                          Available for streaming
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
          </motion.div>
        </div>
      </motion.div>
    </motion.div>
  );
}