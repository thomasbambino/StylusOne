import { useQuery, useQueries, useMutation, useQueryClient } from "@tanstack/react-query";
import { Settings } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { loggers } from '@/lib/logger';
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Tv, Signal, AlertTriangle, Wifi, WifiOff, Play, Pause, Volume2, VolumeX, Maximize, Star, StarOff, Loader2, Cast, PictureInPicture2, TrendingUp, Users } from "lucide-react";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import Hls from "hls.js";
import { motion } from "framer-motion";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { buildApiUrl, isNativePlatform, getPlatform } from "@/lib/capacitor";
import { getQueryFn, apiRequest } from "@/lib/queryClient";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ChevronDown, Filter } from "lucide-react";

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
  isNew?: boolean;
  isLive?: boolean;
}

// IPTV Channel interface
interface IPTVChannel {
  id: string;
  number: string;
  name: string;
  streamUrl: string;
  logo: string;
  epgId: string;
  categoryName: string;
  categoryId: string;
  hasArchive: boolean;
  archiveDays: number;
}

interface IPTVChannelsResponse {
  configured: boolean;
  channels: IPTVChannel[];
}

interface IPTVStatusResponse {
  configured: boolean;
  initialized?: boolean;
  healthy?: boolean;
  userInfo?: {
    username: string;
    status: string;
    expiresAt: string;
    maxConnections: number;
    activeConnections: number;
  };
}

// Unified channel interface for both HDHomeRun and IPTV
interface UnifiedChannel {
  source: 'hdhomerun' | 'iptv' | 'static';
  GuideNumber: string;
  GuideName: string;
  URL: string;
  HD: boolean;
  Favorite: boolean;
  DRM: boolean;
  logo?: string;
  iptvId?: string;
  epgId?: string;
  categoryName?: string;
}

// Channel logos mapping based on Zap2it data
const CHANNEL_LOGOS: Record<string, string> = {
  // Major networks
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

// Channel Guide Row Component
interface ChannelGuideRowProps {
  channel: UnifiedChannel;
  selectedChannel: UnifiedChannel | null;
  onChannelSelect: (channel: UnifiedChannel) => void;
  programs?: EPGProgram[];
  isLoading?: boolean;
  error?: any;
  onToggleFavorite?: (channelId: string, channelName: string, channelLogo: string | undefined, isFavorite: boolean) => void;
  isFavorite?: boolean;
}

function ChannelGuideRow({ channel, selectedChannel, onChannelSelect, programs = [], isLoading = false, error, onToggleFavorite, isFavorite = false }: ChannelGuideRowProps) {
  // Programs are now passed as props instead of fetched via hook

  // Timeline configuration: Show next 4 hours
  const now = new Date();
  const timelineStart = new Date(now);
  // Round to nearest 15-minute increment
  const minutes = timelineStart.getMinutes();
  const roundedMinutes = Math.floor(minutes / 15) * 15;
  timelineStart.setMinutes(roundedMinutes, 0, 0);
  const timelineEnd = new Date(timelineStart);
  timelineEnd.setHours(timelineEnd.getHours() + 4); // 4 hours ahead

  // Calculate total minutes in timeline (240 minutes = 4 hours)
  const totalMinutes = 240;

  // Get current program (first one that's currently airing)
  const currentProgram = programs.find(p =>
    new Date(p.startTime) <= now && new Date(p.endTime) > now
  );

  // Filter programs that fall within our timeline window
  const visiblePrograms = programs.filter(p => {
    const start = new Date(p.startTime);
    const end = new Date(p.endTime);
    return end > timelineStart && start < timelineEnd;
  });

  // Get channel logo
  let channelLogo = channel.logo;
  if (!channelLogo && channel.source === 'hdhomerun') {
    const getChannelLogo = (guideNumber: string, guideName: string) => {
      const channelToLogoMapping: Record<string, string> = {
        '10.1': 'KGTVDT', '10.2': 'KGTVDT2', '10.3': 'KGTVDT3', '10.4': 'KGTVDT4',
        '15.1': 'KPBSDT', '15.2': 'KPBSDT2', '15.3': 'KPBSDT3', '15.4': 'KPBSDT4',
        '39.1': 'KNSDDT', '39.2': 'KNSDDT2', '39.3': 'KNSDDT3', '39.4': 'KNSDDT4',
        '51.1': 'KFMBDT', '51.2': 'KFMBDT2', '51.3': 'KFMBDT3', '51.4': 'KFMBDT4',
        '69.1': 'KSWBDT', '69.2': 'KSWBDT2', '69.3': 'KSWBDT3', '69.4': 'KSWBDT4'
      };
      return channelToLogoMapping[guideNumber] || guideName.split('-')[0].replace(/[^A-Z0-9]/g, '');
    };
    const logoKey = getChannelLogo(channel.GuideNumber, channel.GuideName);
    channelLogo = CHANNEL_LOGOS[logoKey];
  }

  const handleToggleFavorite = () => {
    if (onToggleFavorite && channel.source === 'iptv') {
      onToggleFavorite(channel.iptvId || channel.GuideNumber, channel.GuideName, channelLogo, isFavorite);
    }
  };

  // Calculate program position and width as percentages
  const getProgramStyle = (prog: EPGProgram) => {
    const start = new Date(prog.startTime);
    const end = new Date(prog.endTime);

    // Clamp to timeline bounds
    const clampedStart = start < timelineStart ? timelineStart : start;
    const clampedEnd = end > timelineEnd ? timelineEnd : end;

    // Calculate offset from timeline start as percentage
    const offsetMinutes = (clampedStart.getTime() - timelineStart.getTime()) / (1000 * 60);
    const durationMinutes = (clampedEnd.getTime() - clampedStart.getTime()) / (1000 * 60);

    const leftPercent = (offsetMinutes / totalMinutes) * 100;
    const widthPercent = (durationMinutes / totalMinutes) * 100;

    return {
      left: `${leftPercent}%`,
      width: `${widthPercent}%`
    };
  };

  const content = (
    <div
      className={cn(
        "flex border-b border-border hover:bg-accent/50 cursor-pointer transition-colors",
        selectedChannel?.GuideNumber === channel.GuideNumber && "bg-blue-500/10"
      )}
      onClick={() => onChannelSelect(channel)}
    >
      {/* Channel Info Column */}
      <div className="w-40 flex-shrink-0 p-2 border-r border-border flex items-center gap-2">
        <div className="w-8 h-8 rounded flex items-center justify-center overflow-hidden flex-shrink-0">
          {channelLogo ? (
            <img
              src={channelLogo}
              alt={channel.GuideName}
              className="w-full h-full object-contain"
              loading="lazy"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          ) : (
            <Tv className="w-4 h-4 text-blue-500" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-bold truncate flex items-center gap-1">
            {channel.GuideNumber}
            {isFavorite && <Star className="w-3 h-3 fill-yellow-500 text-yellow-500" />}
          </div>
          <div className="text-[10px] text-muted-foreground truncate">{channel.GuideName}</div>
        </div>
      </div>

      {/* Program Timeline */}
      <div className="flex-1 p-2">
        {isLoading ? (
          <div className="text-xs text-muted-foreground">Loading...</div>
        ) : error ? (
          <div className="text-xs text-red-500">Error loading</div>
        ) : visiblePrograms.length > 0 ? (
          <div className="relative h-14 w-full min-w-full">
            {visiblePrograms.map((prog, idx) => {
              const isCurrentlyPlaying = currentProgram && prog.title === currentProgram.title && prog.startTime === currentProgram.startTime;
              const style = getProgramStyle(prog);
              return (
                <Tooltip key={idx}>
                  <TooltipTrigger asChild>
                    <div
                      className={cn(
                        "absolute top-0 h-full p-1.5 rounded border overflow-hidden cursor-pointer",
                        isCurrentlyPlaying
                          ? "bg-blue-500/10 border-blue-500/30"
                          : "bg-card border-border"
                      )}
                      style={style}
                    >
                      <div className="flex items-center gap-1 mb-0.5">
                        <div className="text-xs font-medium truncate">{prog.title}</div>
                        {prog.isNew && (
                          <span className="text-[9px] px-1 py-0.5 rounded bg-orange-500/20 text-orange-400 font-medium flex-shrink-0 leading-none">
                            New
                          </span>
                        )}
                      </div>
                      {prog.episodeTitle && (
                        <div className="text-[10px] text-muted-foreground truncate">{prog.episodeTitle}</div>
                      )}
                      <div className="text-[9px] text-muted-foreground mt-0.5 truncate">
                        {new Date(prog.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })} -
                        {new Date(prog.endTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                      </div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-sm z-50">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <div className="font-semibold">{prog.title}</div>
                        {prog.isNew && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400 font-medium leading-none">
                            New
                          </span>
                        )}
                      </div>
                      {prog.episodeTitle && (
                        <div className="text-sm text-muted-foreground">{prog.episodeTitle}</div>
                      )}
                      <div className="text-xs text-muted-foreground">
                        {new Date(prog.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })} -
                        {new Date(prog.endTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                      </div>
                      {prog.description && (
                        <div className="text-sm mt-2 pt-2 border-t">{prog.description}</div>
                      )}
                    </div>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">No program info</div>
        )}
      </div>
    </div>
  );

  // Only wrap IPTV channels with context menu
  if (channel.source === 'iptv' && onToggleFavorite) {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          {content}
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={handleToggleFavorite}>
            {isFavorite ? (
              <>
                <StarOff className="mr-2 h-4 w-4" />
                Remove from Favorites
              </>
            ) : (
              <>
                <Star className="mr-2 h-4 w-4" />
                Add to Favorites
              </>
            )}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  return content;
}

// Channel List Item Component
interface ChannelListItemProps {
  channel: UnifiedChannel;
  selectedChannel: UnifiedChannel | null;
  onChannelSelect: (channel: UnifiedChannel) => void;
  program?: EPGProgram | null;
  isLoading?: boolean;
}

function ChannelListItem({ channel, selectedChannel, onChannelSelect, program, isLoading = false }: ChannelListItemProps) {
  // Program is now passed as a prop instead of fetched via hook
  
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

  // Use IPTV logo if available, otherwise use the mapped logo
  const logoKey = getChannelLogo(channel.GuideNumber, channel.GuideName);
  const channelLogo = channel.logo || CHANNEL_LOGOS[logoKey];

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
        "flex-shrink-0 w-10 h-10 rounded border flex items-center justify-center overflow-hidden",
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
          {channel.source === 'static' && (
            <div className={cn(
              "inline-block text-[10px] px-1.5 py-0.5 rounded font-medium",
              isSelected
                ? "bg-white/20 text-white"
                : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
            )}>
              STREAM
            </div>
          )}
          {channel.source === 'iptv' && (
            <div className={cn(
              "inline-block text-[10px] px-1.5 py-0.5 rounded font-medium",
              isSelected
                ? "bg-white/20 text-white"
                : "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400"
            )}>
              IPTV
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
            <div className="flex items-center gap-1.5 mt-0.5">
              <div className={cn(
                "text-xs truncate",
                isSelected ? "text-white/80" : "text-muted-foreground"
              )}>
                {program.title}
                {program.episodeTitle && ` • ${program.episodeTitle}`}
              </div>
              {program.isNew && (
                <span className="text-[9px] px-1 py-0.5 rounded bg-orange-500/20 text-orange-400 font-medium flex-shrink-0 leading-none">
                  New
                </span>
              )}
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
  const [selectedChannel, setSelectedChannel] = useState<UnifiedChannel | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [showControls, setShowControls] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentSession, setCurrentSession] = useState<TunerSession | null>(null);
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [isCasting, setIsCasting] = useState(false);
  const [castSession, setCastSession] = useState<any>(null);
  const [visibleChannelCount, setVisibleChannelCount] = useState(100); // Start with 100 channels
  const [isPiPActive, setIsPiPActive] = useState(false);
  const fullscreenContainerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const playbackTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const channelListRef = useRef<HTMLDivElement | null>(null);
  const isPiPActiveRef = useRef(false); // Ref for cleanup functions

  // IPTV stream tracking (separate from HDHomeRun tuner tracking)
  const iptvSessionToken = useRef<string | null>(null);
  const iptvHeartbeatRef = useRef<NodeJS.Timeout | null>(null);

  const { data: settings } = useQuery<Settings>({
    queryKey: ["/api/settings"],
    // Uses default queryFn from queryClient which handles native platforms
  });

  const { data: deviceInfo, isLoading: deviceLoading, error: deviceError } = useQuery<HDHomeRunDeviceResponse>({
    queryKey: ["/api/hdhomerun/devices"],
    // Uses default queryFn
    refetchInterval: 30000
  });

  const { data: channelsData, isLoading: channelsLoading } = useQuery<HDHomeRunChannelsResponse>({
    queryKey: ["/api/hdhomerun/channels"],
    // Uses default queryFn
    enabled: deviceInfo?.configured === true,
    refetchInterval: 60000
  });

  const { data: tunersData } = useQuery<HDHomeRunTunersResponse>({
    queryKey: ["/api/hdhomerun/tuners"],
    // Uses default queryFn
    enabled: deviceInfo?.configured === true,
    refetchInterval: 5000
  });

  // Query for tuner management status
  const { data: tunerStatusData } = useQuery<TunerStatus>({
    queryKey: ["/api/tuner/status"],
    // Uses default queryFn
    enabled: deviceInfo?.configured === true,
    refetchInterval: 2000
  });

  // IPTV queries
  const { data: iptvStatus } = useQuery<IPTVStatusResponse>({
    queryKey: ["/api/iptv/status"],
    // Uses default queryFn
    refetchInterval: 60000
  });

  const { data: iptvChannelsData, isLoading: iptvChannelsLoading } = useQuery<IPTVChannelsResponse>({
    queryKey: ["/api/iptv/channels"],
    // Uses default queryFn
    enabled: iptvStatus?.configured === true,
    refetchInterval: 300000 // 5 minutes
  });

  // User's channel packages for filtering
  interface ChannelPackage {
    packageId: number;
    packageName: string;
    channelCount: number;
  }
  const { data: userPackages = [] } = useQuery<ChannelPackage[]>({
    queryKey: ['/api/subscriptions/packages'],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  // Fetch channels for each package to build a mapping
  const packageChannelsQueries = useQueries({
    queries: userPackages.map(pkg => ({
      queryKey: [`/api/subscriptions/packages/${pkg.packageId}/channels`],
      queryFn: getQueryFn({ on401: "returnNull" }),
      enabled: !!pkg.packageId,
      staleTime: 5 * 60 * 1000,
    })),
  });

  // Build a map of channel name -> package IDs (same approach as iOS for reliable matching)
  // Check if all package channel queries have completed loading
  const allPackageQueriesLoaded = packageChannelsQueries.length > 0 &&
    packageChannelsQueries.every(q => !q.isLoading && q.data !== undefined);

  // Extract just the data arrays and create a stable key for memoization
  const packageChannelsDataKey = packageChannelsQueries.map(q =>
    q.data ? (q.data as Array<{name: string}>).length : 0
  ).join(',');

  const channelToPackages = useMemo(() => {
    const map = new Map<string, Set<number>>();

    // Debug: Log initial state
    console.log('[PackageFilter] Building map:', {
      userPackagesLength: userPackages.length,
      allPackageQueriesLoaded,
      queriesLength: packageChannelsQueries.length,
      queriesData: packageChannelsQueries.map((q, i) => ({
        index: i,
        isLoading: q.isLoading,
        hasData: q.data !== undefined && q.data !== null,
        dataLength: Array.isArray(q.data) ? q.data.length : 'not-array'
      }))
    });

    // Only build the map if we have packages AND their channel data is loaded
    if (!allPackageQueriesLoaded || userPackages.length === 0) {
      console.log('[PackageFilter] Skipping map build - not ready');
      return map;
    }

    userPackages.forEach((pkg, index) => {
      const channels = packageChannelsQueries[index]?.data as Array<{ id: string; name: string }> | null | undefined;
      console.log(`[PackageFilter] Package ${pkg.packageId} (${pkg.packageName}):`, {
        hasChannels: !!channels,
        channelCount: Array.isArray(channels) ? channels.length : 0
      });
      if (channels && Array.isArray(channels)) {
        channels.forEach(ch => {
          if (ch.name) {
            const normalizedName = ch.name.toLowerCase().trim();
            const existing = map.get(normalizedName) || new Set();
            existing.add(pkg.packageId);
            map.set(normalizedName, existing);
          }
        });
      }
    });

    console.log('[PackageFilter] Map built:', {
      totalChannelNames: map.size,
      sampleNames: Array.from(map.keys()).slice(0, 10)
    });

    return map;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userPackages, allPackageQueriesLoaded, packageChannelsDataKey, packageChannelsQueries]);

  // Favorite channels query
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: favoriteChannels = [] } = useQuery<Array<{id: number, channelId: string, channelName: string, channelLogo: string | null}>>({
    queryKey: ["/api/favorite-channels"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    refetchInterval: 60000
  });

  const addFavoriteMutation = useMutation({
    mutationFn: async ({ channelId, channelName, channelLogo }: { channelId: string, channelName: string, channelLogo: string | undefined }) => {
      const res = await apiRequest("POST", "/api/favorite-channels", {
        channelId,
        channelName,
        channelLogo: channelLogo || null
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/favorite-channels"] });
      toast({ title: "Added to favorites" });
    }
  });

  const removeFavoriteMutation = useMutation({
    mutationFn: async (channelId: string) => {
      const res = await apiRequest("DELETE", `/api/favorite-channels/${channelId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/favorite-channels"] });
      toast({ title: "Removed from favorites" });
    }
  });

  const handleToggleFavorite = (channelId: string, channelName: string, channelLogo: string | undefined, isFavorite: boolean) => {
    if (isFavorite) {
      removeFavoriteMutation.mutate(channelId);
    } else {
      addFavoriteMutation.mutate({ channelId, channelName, channelLogo });
    }
  };

  // Trending channels for Home section
  interface TrendingChannel {
    channelId: string;
    channelName: string;
    viewerCount: number;
  }
  const { data: trendingChannels = [] } = useQuery<TrendingChannel[]>({
    queryKey: ['/api/iptv/trending'],
    queryFn: getQueryFn({ on401: "returnNull" }),
    refetchInterval: 30000, // Refresh every 30 seconds
    select: (data: any) => data?.trending || [],
  });

  // Fetch current program for selected channel - MUST be before any early returns
  // For IPTV channels, use epgId (the XMLTV channel ID), for HDHomeRun use GuideNumber
  const selectedChannelKey = selectedChannel?.source === 'iptv'
    ? selectedChannel?.epgId
    : selectedChannel?.GuideNumber;
  const { data: selectedChannelProgram, isLoading: selectedChannelProgramLoading } = useQuery({
    queryKey: [`/api/epg/current/${encodeURIComponent(selectedChannelKey || '')}`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    select: (data: any) => {
      loggers.tv.debug('Received program data', { data });
      return data?.program as EPGProgram | null;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchInterval: 5 * 60 * 1000, // Refetch every 5 minutes
    enabled: !!selectedChannel && !!selectedChannelKey
  });

  // State for HDHomeRun channel visibility and search - MUST be before early returns
  const [showHDHomeRun, setShowHDHomeRun] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPackageIds, setSelectedPackageIds] = useState<Set<number>>(new Set());

  // Prepare channel list for EPG queries (before early returns)
  // Convert HDHomeRun channels to unified format
  const hdHomeRunChannels: UnifiedChannel[] = (channelsData?.channels?.filter(ch => !ch.DRM) || []).map(ch => ({
    source: 'hdhomerun' as const,
    GuideNumber: ch.GuideNumber,
    GuideName: ch.GuideName,
    URL: ch.URL,
    HD: ch.HD,
    Favorite: ch.Favorite,
    DRM: ch.DRM
  }));

  // Convert IPTV channels to unified format
  const iptvChannels: UnifiedChannel[] = (iptvChannelsData?.channels || []).map(ch => ({
    source: 'iptv' as const,
    GuideNumber: ch.number,
    GuideName: ch.name,
    URL: ch.streamUrl,
    HD: true, // Assume IPTV channels are HD
    Favorite: false,
    DRM: false,
    logo: ch.logo,
    iptvId: ch.id,
    epgId: ch.epgId,
    categoryName: ch.categoryName
  }));

  const allChannels = [...hdHomeRunChannels, ...iptvChannels];

  // Calculate filtered channels early to determine which channels to fetch EPG for
  let filteredChannels = [...allChannels];

  // Filter out HDHomeRun channels if hidden
  if (!showHDHomeRun) {
    filteredChannels = filteredChannels.filter(ch => ch.source !== 'hdhomerun');
  }

  // Filter by selected packages (multi-select) - uses channel NAME matching like iOS
  if (selectedPackageIds.size > 0) {
    console.log('[PackageFilter] Filter requested:', {
      selectedPackageIds: Array.from(selectedPackageIds),
      channelToPackagesSize: channelToPackages.size
    });

    if (channelToPackages.size === 0) {
      // Package data not loaded yet - log for debugging
      console.log('[PackageFilter] Map is empty - filter skipped');
    } else {
      const beforeCount = filteredChannels.length;

      // Debug: Check first few channels for matching
      const debugChannels = filteredChannels.slice(0, 5);
      debugChannels.forEach(ch => {
        const normalizedName = ch.GuideName.toLowerCase().trim();
        const packageIds = channelToPackages.get(normalizedName);
        console.log(`[PackageFilter] Channel "${ch.GuideName}" -> normalized: "${normalizedName}" -> packages:`, packageIds ? Array.from(packageIds) : 'NOT FOUND');
      });

      filteredChannels = filteredChannels.filter(ch => {
        // Match by channel name (normalized) - same approach as iOS
        const normalizedName = ch.GuideName.toLowerCase().trim();
        const packageIds = channelToPackages.get(normalizedName);

        // If channel isn't in any package data, hide it when filtering
        if (!packageIds || packageIds.size === 0) return false;

        // Show channel if it belongs to ANY of the selected packages
        return Array.from(packageIds).some(pkgId => selectedPackageIds.has(pkgId));
      });

      console.log('[PackageFilter] Filter applied:', {
        before: beforeCount,
        after: filteredChannels.length,
        selectedPackages: Array.from(selectedPackageIds)
      });
    }
  }

  // Note: Search filtering happens AFTER EPG data loads (see availableChannels below)
  // We need to load EPG first to search program titles

  // Fetch EPG data for visible channels only (infinite scroll)
  // Load EPG data in batches as user scrolls for better performance
  const channelsForEPG = filteredChannels.slice(0, visibleChannelCount);
  const epgQueries = useQueries({
    queries: channelsForEPG.map((channel) => {
      // For IPTV channels, use epgId (XMLTV channel ID), for HDHomeRun use GuideNumber
      const channelKey = channel.source === 'iptv' ? channel.epgId : channel.GuideNumber;
      const channelName = channel.GuideName || '';
      if (!channelKey) {
        return {
          queryKey: ['epg', 'upcoming', 'none'],
          queryFn: async () => [],
          staleTime: 5 * 60 * 1000,
          refetchInterval: 5 * 60 * 1000,
        };
      }
      // Include channel name for fallback matching when epgId doesn't match
      return {
        queryKey: [`/api/epg/upcoming/${encodeURIComponent(channelKey)}?hours=168&name=${encodeURIComponent(channelName)}`],
        queryFn: getQueryFn({ on401: "returnNull" }),
        select: (data: any) => (data?.programs || []) as EPGProgram[],
        staleTime: 30 * 60 * 1000, // 30 minutes (extended EPG data doesn't change often)
        refetchInterval: 30 * 60 * 1000,
      };
    })
  });

  // Create a map of channel ID/number to EPG data
  const epgDataMap = new Map<string, EPGProgram[]>();
  channelsForEPG.forEach((channel, index) => {
    // Use epgId for IPTV channels, GuideNumber for HDHomeRun
    const channelKey = channel.source === 'iptv' ? channel.epgId : channel.GuideNumber;
    if (channelKey) {
      epgDataMap.set(channelKey, epgQueries[index]?.data || []);
    }
  });

  // Build a simple lookup map from channel ID to channel data (same approach as home page)
  // This avoids complex find() operations that could match wrong channels
  const channelLookupById = useMemo(() => {
    const lookup = new Map<string, UnifiedChannel>();
    allChannels.forEach(ch => {
      // For IPTV: use iptvId (streamId), for HDHomeRun: use GuideNumber
      const key = ch.source === 'iptv' ? ch.iptvId : ch.GuideNumber;
      if (key) {
        lookup.set(key, ch);
      }
    });
    return lookup;
  }, [allChannels]);

  // Fetch EPG data for favorites - EXACT same approach as home page (which works)
  // Use a SINGLE query with queryFn that does the lookup INSIDE (not during render)
  // This ensures channels are loaded before we try to look them up
  const favoriteChannelIds = useMemo(
    () => favoriteChannels.map(fav => fav.channelId),
    [favoriteChannels]
  );

  const { data: favoriteEpgDataMap = new Map<string, EPGProgram | null>() } = useQuery<Map<string, EPGProgram | null>>({
    queryKey: ['/api/epg/favorites-batch', favoriteChannelIds.join(','), allChannels.length],
    queryFn: async () => {
      if (favoriteChannelIds.length === 0) return new Map();

      const programs = new Map<string, EPGProgram | null>();
      await Promise.all(
        favoriteChannels.map(async (fav) => {
          try {
            // Look up full channel data to get epgId - this happens INSIDE queryFn
            // so channels are guaranteed to be loaded (see enabled condition)
            const channel = channelLookupById.get(fav.channelId);
            // Use epgId for precise EPG matching, fall back to channelName
            const epgKey = channel?.epgId || fav.channelName;
            const response = await apiRequest("GET", `/api/epg/current/${encodeURIComponent(epgKey)}`);
            if (response.ok) {
              const data = await response.json();
              programs.set(fav.channelId, data.program || null);
            } else {
              programs.set(fav.channelId, null);
            }
          } catch {
            // EPG fetch failed silently - UI shows fallback
            programs.set(fav.channelId, null);
          }
        })
      );
      return programs;
    },
    refetchInterval: 5 * 60 * 1000, // 5 minutes
    staleTime: 5 * 60 * 1000,
    // CRITICAL: Only run when channels have loaded so lookups work correctly
    enabled: favoriteChannelIds.length > 0 && allChannels.length > 0,
  });

  // Auto-select first channel on load is disabled - users must manually select a channel

  // Fullscreen change event listener
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFullscreenActive = !!(
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).mozFullScreenElement ||
        (document as any).msFullscreenElement
      );
      setIsFullscreen(isFullscreenActive);
    };

    // Listen to all fullscreen change events for cross-browser compatibility
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('msfullscreenchange', handleFullscreenChange);

    // Also listen for video-specific fullscreen events on mobile
    if (videoRef.current) {
      videoRef.current.addEventListener('webkitbeginfullscreen', () => setIsFullscreen(true));
      videoRef.current.addEventListener('webkitendfullscreen', () => setIsFullscreen(false));
    }

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('msfullscreenchange', handleFullscreenChange);
      
      if (videoRef.current) {
        videoRef.current.removeEventListener('webkitbeginfullscreen', () => setIsFullscreen(true));
        videoRef.current.removeEventListener('webkitendfullscreen', () => setIsFullscreen(false));
      }
    };
  }, []);

  // Track scroll container element for infinite scroll
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);

  // Callback ref to capture scroll container when it mounts
  const setChannelListRef = useCallback((node: HTMLDivElement | null) => {
    channelListRef.current = node;
    setScrollElement(node);
  }, []);

  // Infinite scroll for channel guide - load more EPG data as user scrolls
  useEffect(() => {
    if (!scrollElement) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = scrollElement;
      const scrollPercentage = (scrollTop + clientHeight) / scrollHeight;
      const remainingChannels = filteredChannels.length - visibleChannelCount;

      // Load more when scrolled 70% down and there are more channels to load
      if (scrollPercentage > 0.7 && remainingChannels > 0) {
        const newCount = Math.min(visibleChannelCount + 50, filteredChannels.length);
        loggers.tv.debug('Loading more channels', { from: visibleChannelCount, to: newCount });
        setVisibleChannelCount(newCount);
      }
    };

    scrollElement.addEventListener('scroll', handleScroll);
    return () => scrollElement.removeEventListener('scroll', handleScroll);
  }, [scrollElement, visibleChannelCount, filteredChannels.length]);

  // Reset visible channel count when filters change
  useEffect(() => {
    setVisibleChannelCount(100);
  }, [searchQuery, showHDHomeRun]);

  // Initialize Cast API
  useEffect(() => {
    let pollInterval: NodeJS.Timeout | null = null;
    let attempts = 0;
    const maxAttempts = 150; // Try for 15 seconds (150 * 100ms)

    const initializeCast = () => {
      const cast = (window as any).cast;

      // Debug logging every 50 attempts (every 5 seconds)
      if (attempts % 50 === 0 && attempts > 0) {
        loggers.tv.debug('Cast SDK check', { elapsedSeconds: attempts/10, castExists: !!cast, frameworkExists: !!cast?.framework });
      }

      if (!cast || !cast.framework) {
        return false;
      }

      try {
        loggers.tv.info('Cast SDK is now available, initializing');
        const castContext = cast.framework.CastContext.getInstance();

        // Use custom receiver app ID if configured, otherwise use default
        // To use custom receiver: Set VITE_CAST_RECEIVER_APP_ID in .env file
        // See CAST_RECEIVER_SETUP.md for instructions on registering custom receiver
        const customAppId = import.meta.env.VITE_CAST_RECEIVER_APP_ID;
        const receiverAppId = customAppId || (window as any).chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID;

        loggers.tv.debug('Using Cast receiver', { receiverType: customAppId ? 'Custom (Stylus One)' : 'Default' });

        castContext.setOptions({
          receiverApplicationId: receiverAppId,
          autoJoinPolicy: (window as any).chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
        });

        // Listen for cast session changes
        castContext.addEventListener(
          cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
          (event: any) => {
            loggers.tv.debug('Cast session state changed', { event });
            const session = castContext.getCurrentSession();
            setCastSession(session);
            setIsCasting(!!session);

            // Resume local playback when casting ends
            if (!session && event.sessionState === 'SESSION_ENDED' && selectedChannel) {
              loggers.tv.info('Resuming local playback after cast ended');
              // Reload the channel in the browser
              handleChannelSelect(selectedChannel);
            }

            // Only load media when session is starting/started, not when ending
            if (session && selectedChannel && event.sessionState === 'SESSION_STARTED') {
              loggers.tv.info('Loading media to cast device', { channelName: selectedChannel.GuideName });

              // Request a stream token for Chromecast authentication
              (async () => {
                try {
                  loggers.tv.debug('Requesting stream token for Chromecast');
                  const tokenResponse = await apiRequest('POST', '/api/iptv/generate-token', {
                    streamId: selectedChannel.iptvId,
                    deviceType: getPlatform()
                  });

                  const { token } = await tokenResponse.json();
                  loggers.tv.debug('Stream token received');

                  // Load media to cast device with token
                  const streamUrl = buildApiUrl(`/api/iptv/stream/${selectedChannel.iptvId}.m3u8?token=${token}`);
                  loggers.tv.debug('Stream URL with token', { streamUrl: streamUrl.replace(/token=[^&]+/, 'token=***') });

                  const chromecast = (window as any).chrome.cast;
                  const mediaInfo = new chromecast.media.MediaInfo(streamUrl, 'application/x-mpegurl');

                  // Configure for live HLS streaming
                  mediaInfo.streamType = chromecast.media.StreamType.LIVE;

                  const metadata = new chromecast.media.TvShowMediaMetadata();
                  metadata.seriesTitle = 'Stylus One';
                  metadata.title = selectedChannel.GuideName;
                  metadata.subtitle = selectedChannelProgram?.title || 'Live TV';
                  if (selectedChannel.logo) {
                    metadata.images = [new chromecast.media.Image(selectedChannel.logo)];
                  }
                  mediaInfo.metadata = metadata;

                  const request = new chromecast.media.LoadRequest(mediaInfo);
                  request.autoplay = true;

                  session.loadMedia(request).then(
                    () => {
                      loggers.tv.info('Media loaded successfully to cast device');

                      // Listen for media status updates
                      const media = session.getMediaSession();
                      if (media) {
                        let bufferingTimeout: NodeJS.Timeout | null = null;
                        let lastBufferingState = false;

                        media.addUpdateListener((isAlive: boolean) => {
                          if (!isAlive) {
                            loggers.tv.debug('Media session ended');
                            if (bufferingTimeout) {
                              clearTimeout(bufferingTimeout);
                              bufferingTimeout = null;
                            }
                          } else {
                            const playerState = media.playerState;
                            const isBuffering = playerState === 'BUFFERING';

                            loggers.tv.debug('Media status', {
                              playerState: playerState,
                              idleReason: media.idleReason,
                              currentTime: media.getEstimatedTime()
                            });

                            // Detect stuck buffering
                            if (isBuffering && !lastBufferingState) {
                              loggers.tv.debug('Started buffering');
                              // Set timeout to detect if buffering too long
                              bufferingTimeout = setTimeout(() => {
                                loggers.tv.error('Buffering timeout - stream may be stuck');
                                // Could potentially try to reload here, but for now just log
                              }, 15000); // 15 second buffering timeout
                            } else if (!isBuffering && lastBufferingState) {
                              loggers.tv.debug('Buffering complete');
                              if (bufferingTimeout) {
                                clearTimeout(bufferingTimeout);
                                bufferingTimeout = null;
                              }
                            }

                            lastBufferingState = isBuffering;
                          }
                        });
                      }

                      // Stop local playback when casting
                      loggers.tv.info('Stopping local playback for Chromecast');
                      if (videoRef.current) {
                        videoRef.current.pause();
                        videoRef.current.src = ''; // Clear the source
                      }
                      // Also destroy HLS instance if using HLS
                      if (hlsRef.current) {
                        loggers.tv.debug('Destroying HLS instance');
                        hlsRef.current.destroy();
                        hlsRef.current = null;
                      }
                    },
                    (error: any) => {
                      loggers.tv.error('Error loading media to cast device', { error, code: error?.code, details: error?.description || error?.message });
                    }
                  );
                } catch (error) {
                  loggers.tv.error('Error generating stream token', { error });
                }
              })();
            }
          }
        );

        loggers.tv.info('Cast API initialized successfully');
        if (pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
        return true;
      } catch (error) {
        loggers.tv.error('Error initializing cast', { error });
        return false;
      }
    };

    // Poll for Cast SDK availability
    loggers.tv.debug('Polling for Cast SDK');
    pollInterval = setInterval(() => {
      attempts++;

      if (initializeCast()) {
        // Success! Clear interval
        if (pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
      } else if (attempts >= maxAttempts) {
        // Timeout - give up
        const cast = (window as any).cast;
        loggers.tv.warn('Cast SDK did not load after 15 seconds', { castExists: !!cast, frameworkExists: !!cast?.framework });
        if (pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
      }
    }, 100); // Check every 100ms

    // Also set up the callback as fallback
    (window as any).__onGCastApiAvailable = (isAvailable: boolean) => {
      loggers.tv.debug('Cast SDK availability callback fired', { isAvailable });
      if (isAvailable) {
        setTimeout(() => {
          if (initializeCast() && pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
          }
        }, 100);
      }
    };

    return () => {
      // Cleanup
      if (pollInterval) {
        clearInterval(pollInterval);
      }

      const cast = (window as any).chrome?.cast;
      if (cast) {
        try {
          const castContext = cast.framework.CastContext.getInstance();
          const session = castContext.getCurrentSession();
          if (session) {
            loggers.tv.debug('Cleaning up cast session');
            session.endSession(false);
          }
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    };
  }, [selectedChannel, selectedChannelProgram]);

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
      // Don't destroy HLS if PiP is active - let it continue playing
      if (hlsRef.current && !isPiPActiveRef.current) {
        loggers.tv.debug('Destroying HLS instance on component unmount', { stack: new Error().stack });
        hlsRef.current.destroy();
      } else if (isPiPActiveRef.current) {
        loggers.tv.debug('Skipping HLS destruction - PiP is active');
      }
    };
  }, []);

  // Cleanup on unmount and page unload - MOVED HERE BEFORE EARLY RETURNS
  useEffect(() => {
    const handleBeforeUnload = () => {
      // Release HDHomeRun session
      if (currentSession) {
        const data = JSON.stringify({ sessionId: currentSession.id });
        if (navigator.sendBeacon) {
          navigator.sendBeacon(buildApiUrl('/api/tuner/release-session'), data);
        } else {
          fetch(buildApiUrl('/api/tuner/release-session'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: data,
            keepalive: true,
            credentials: 'include',
          }).catch((error) => loggers.tv.error('Error releasing session on beforeunload', { error }));
        }
      }
      // Release IPTV session
      if (iptvSessionToken.current) {
        const iptvData = JSON.stringify({ sessionToken: iptvSessionToken.current });
        if (navigator.sendBeacon) {
          navigator.sendBeacon(buildApiUrl('/api/iptv/stream/release'), iptvData);
        }
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && currentSession) {
        if (heartbeatIntervalRef.current) {
          clearInterval(heartbeatIntervalRef.current);
          heartbeatIntervalRef.current = null;
        }
      } else if (document.visibilityState === 'visible' && currentSession) {
        startHeartbeat(currentSession.id);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);

      // Don't destroy HLS if PiP is active - let it continue playing
      if (hlsRef.current && !isPiPActiveRef.current) {
        loggers.tv.debug('Destroying HLS instance during session release', { stack: new Error().stack });
        hlsRef.current.destroy();
      } else if (isPiPActiveRef.current) {
        loggers.tv.debug('Skipping HLS destruction during session release - PiP is active');
      }

      if (currentSession) {
        releaseCurrentSession();
      }

      // Release IPTV session on unmount
      if (iptvHeartbeatRef.current) {
        clearInterval(iptvHeartbeatRef.current);
      }
      if (iptvSessionToken.current) {
        navigator.sendBeacon(
          buildApiUrl('/api/iptv/stream/release'),
          JSON.stringify({ sessionToken: iptvSessionToken.current })
        );
      }
    };
  }, []);

  // Keyboard shortcut: Ctrl+H to toggle HDHomeRun channels - MOVED HERE BEFORE EARLY RETURNS
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'h') {
        e.preventDefault();
        setShowHDHomeRun(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
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
          loggers.tv.error('Error playing video', { error });
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

  const handleCast = () => {
    loggers.tv.debug('Cast button clicked', {
      castExists: !!(window as any).cast,
      frameworkExists: !!(window as any).cast?.framework,
      sdkLoadError: (window as any).__castSdkLoadError
    });

    const cast = (window as any).cast;
    if (!cast || !cast.framework) {
      const loadError = (window as any).__castSdkLoadError;
      loggers.tv.error('Cast API not available');

      if (loadError === 'CDN Error') {
        alert('Failed to load Chromecast SDK from Google. Check your internet connection or firewall settings.');
      } else if (loadError === 'SDK not loaded') {
        alert('Chromecast SDK failed to initialize. Try refreshing the page or check browser console for errors.');
      } else {
        // Check if this is actually Chrome/Edge
        const userAgent = navigator.userAgent;
        const isChrome = /Chrome/.test(userAgent) && /Google Inc/.test(navigator.vendor);
        const isEdge = /Edg/.test(userAgent);

        loggers.tv.debug('Browser detection', { isChrome, isEdge, userAgent });

        if (!isChrome && !isEdge) {
          alert('Chromecast is only available in Chrome or Microsoft Edge browsers.');
        } else {
          alert('Chromecast SDK not loaded. The page may still be loading - please wait a few seconds and try again. If the problem persists, check if Google services are blocked by your firewall.');
        }
      }
      return;
    }

    try {
      const castContext = cast.framework.CastContext.getInstance();
      const session = castContext.getCurrentSession();

      if (session) {
        // Stop casting
        loggers.tv.debug('Stopping cast session');
        session.endSession(true);
      } else {
        // Start casting
        loggers.tv.debug('Requesting cast session');
        castContext.requestSession().then(() => {
          loggers.tv.info('Cast session started successfully');
        }).catch((error: any) => {
          loggers.tv.error('Error starting cast', { error });
          if (error === 'cancel') {
            loggers.tv.debug('User cancelled cast session');
          } else {
            alert('Failed to connect to Chromecast device. Make sure your device is on the same network.');
          }
        });
      }
    } catch (error) {
      loggers.tv.error('Error in handleCast', { error });
      alert('Chromecast is still initializing. Please wait a moment and try again.');
    }
  };

  const handleFullscreen = async () => {
    if (!fullscreenContainerRef.current) return;
    
    try {
      // Check if we're currently in fullscreen
      const isCurrentlyFullscreen = !!(
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).mozFullScreenElement ||
        (document as any).msFullscreenElement
      );
      
      if (isCurrentlyFullscreen) {
        // Exit fullscreen
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if ((document as any).webkitExitFullscreen) {
          await (document as any).webkitExitFullscreen();
        } else if ((document as any).mozCancelFullScreen) {
          await (document as any).mozCancelFullScreen();
        } else if ((document as any).msExitFullscreen) {
          await (document as any).msExitFullscreen();
        }
      } else {
        // Enter fullscreen
        const element = fullscreenContainerRef.current;
        
        if (element.requestFullscreen) {
          await element.requestFullscreen();
        } else if ((element as any).webkitRequestFullscreen) {
          await (element as any).webkitRequestFullscreen();
        } else if ((element as any).webkitEnterFullscreen) {
          // iOS Safari fallback
          await (element as any).webkitEnterFullscreen();
        } else if ((element as any).mozRequestFullScreen) {
          await (element as any).mozRequestFullScreen();
        } else if ((element as any).msRequestFullscreen) {
          await (element as any).msRequestFullscreen();
        } else {
          loggers.tv.warn('Fullscreen API not supported on this device');
          // Fallback: try to make the video element go fullscreen on mobile
          if (videoRef.current && (videoRef.current as any).webkitEnterFullscreen) {
            (videoRef.current as any).webkitEnterFullscreen();
          }
        }
      }
    } catch (error) {
      loggers.tv.error('Error toggling fullscreen', { error });

      // Mobile Safari fallback - try the video element directly
      if (videoRef.current) {
        try {
          if ((videoRef.current as any).webkitEnterFullscreen) {
            loggers.tv.debug('Trying iOS Safari video fullscreen fallback');
            (videoRef.current as any).webkitEnterFullscreen();
          } else if ((videoRef.current as any).requestFullscreen) {
            await (videoRef.current as any).requestFullscreen();
          }
        } catch (fallbackError) {
          loggers.tv.error('Fullscreen fallback also failed', { error: fallbackError });
        }
      }
    }
  };

  // Picture-in-Picture support
  const isPiPSupported = typeof document !== 'undefined' && 'pictureInPictureEnabled' in document;

  const handlePiP = async () => {
    const video = videoRef.current;
    if (!video) return;

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await video.requestPictureInPicture();
      }
    } catch (error) {
      loggers.tv.error('Error toggling Picture-in-Picture', { error });
    }
  };

  // Track PiP state changes for cleanup handling
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handlePiPEnter = () => {
      setIsPiPActive(true);
      isPiPActiveRef.current = true;
      loggers.tv.debug('Entered Picture-in-Picture mode');
    };

    const handlePiPExit = () => {
      setIsPiPActive(false);
      isPiPActiveRef.current = false;
      loggers.tv.debug('Exited Picture-in-Picture mode');
    };

    video.addEventListener('enterpictureinpicture', handlePiPEnter);
    video.addEventListener('leavepictureinpicture', handlePiPExit);

    // Check if already in PiP on mount
    if (document.pictureInPictureElement === video) {
      setIsPiPActive(true);
      isPiPActiveRef.current = true;
    }

    return () => {
      video.removeEventListener('enterpictureinpicture', handlePiPEnter);
      video.removeEventListener('leavepictureinpicture', handlePiPExit);
    };
  }, []);

  const showControlsTemporarily = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      setShowControls(false);
    }, 3000);
  };

  // Function to play static streams directly (like CBS 8)
  const playStreamDirectly = (streamUrl: string) => {
    if (!videoRef.current) return;

    const video = videoRef.current;
    
    // Clean up existing HLS instance
    if (hlsRef.current) {
      loggers.tv.debug('Destroying existing HLS instance for direct stream');
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    loggers.tv.debug('Loading direct stream', { streamUrl });
    
    if (Hls.isSupported()) {
      // Use HLS.js for browsers that support it
      const hls = new Hls({
        debug: false,
        enableWorker: true,
        lowLatencyMode: false, // Disabled for stability (prevents buffering)
        startPosition: -1, // Start at live edge
        liveSyncDuration: 6, // Stay 6 seconds behind live edge for stability
        liveMaxLatencyDuration: 15, // Max drift before seeking to live
        backBufferLength: 60, // Increased for smoother playback
        maxBufferLength: 60, // Match native app settings
        maxMaxBufferLength: 120, // Allow more buffer room
        maxBufferSize: 120 * 1000 * 1000, // 120MB buffer size
        maxBufferHole: 0.8, // Higher tolerance for buffer holes (prevents stalls)
        nudgeOffset: 0.2, // Better stall recovery
        nudgeMaxRetry: 5, // More retries for recovery
        liveDurationInfinity: true,
        // Relaxed timeouts for stability
        fragLoadingTimeOut: 30000,
        fragLoadingMaxRetry: 6,
        fragLoadingRetryDelay: 1000,
        manifestLoadingTimeOut: 20000,
        manifestLoadingMaxRetry: 4,
        manifestLoadingRetryDelay: 1000,
        startFragPrefetch: true, // Prefetch segments
        progressive: true, // Progressive streaming for faster startup
        xhrSetup: function(xhr: XMLHttpRequest) {
          // Include credentials (cookies) with all HLS requests for authentication
          xhr.withCredentials = true;
        },
      });
      
      hlsRef.current = hls;

      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        loggers.tv.debug('Direct stream HLS media attached to video element');
      });

      hls.on(Hls.Events.MANIFEST_LOADING, () => {
        loggers.tv.debug('Direct stream HLS manifest loading started');
        setIsLoading(true);
      });

      hls.on(Hls.Events.MANIFEST_LOADED, (event, data) => {
        loggers.tv.debug('Direct stream HLS manifest loaded', { data });
      });

      // Track if we've started playback to avoid duplicate play() calls
      let playbackStarted = false;

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        loggers.tv.debug('Direct stream HLS manifest parsed');
        // Don't start playback here - wait for FRAG_BUFFERED for faster startup
      });

      // Wait for sufficient buffer before starting playback (prevents initial buffering)
      let fragmentsBuffered = 0;
      const MIN_FRAGMENTS_BEFORE_PLAY = 2; // Wait for ~12 seconds of buffer (2 x 6s segments)

      hls.on(Hls.Events.FRAG_BUFFERED, () => {
        fragmentsBuffered++;
        if (!playbackStarted && fragmentsBuffered >= MIN_FRAGMENTS_BEFORE_PLAY) {
          playbackStarted = true;
          loggers.tv.debug('Sufficient buffer ready, starting playback', { fragmentsBuffered });
          video.play().then(() => {
            loggers.tv.info('Direct stream started playing successfully');
            setIsPlaying(true);
            setIsLoading(false);
            setIsBuffering(false);
          }).catch(error => {
            loggers.tv.error('Direct stream play error', { error });
            // Try again with muted autoplay as fallback
            video.muted = true;
            video.play().then(() => {
              loggers.tv.debug('Direct stream playing muted');
              setIsPlaying(true);
              setIsLoading(false);
              setIsBuffering(false);
            }).catch(err => {
              loggers.tv.error('Direct stream muted play also failed', { error: err });
              setIsLoading(false);
              setIsBuffering(false);
            });
          });
        }
      });

      hls.on(Hls.Events.ERROR, (event, data) => {
        loggers.tv.error('Direct stream HLS error', { data });
        if (data.fatal) {
          loggers.tv.debug('Fatal direct stream error, destroying HLS instance');
          hls.destroy();
          setIsLoading(false);
          setIsBuffering(false);
        }
      });

      // Add video event listeners
      video.addEventListener('play', () => {
        loggers.tv.debug('Direct stream video play event');
        setIsPlaying(true);
      });

      video.addEventListener('waiting', () => {
        loggers.tv.debug('Video buffering started');
        setIsBuffering(true);
      });

      video.addEventListener('playing', () => {
        loggers.tv.debug('Video playing after buffering');
        setIsBuffering(false);
        setIsLoading(false);
      });

      video.addEventListener('canplay', () => {
        loggers.tv.debug('Video can play');
        setIsBuffering(false);
        setIsLoading(false);
      });
      video.addEventListener('pause', () => {
        loggers.tv.debug('Direct stream video pause event');
        setIsPlaying(false);
      });
      video.addEventListener('waiting', () => {
        loggers.tv.debug('Direct stream video waiting/buffering');
      });
      video.addEventListener('canplay', () => {
        loggers.tv.debug('Direct stream video can play');
      });
      video.addEventListener('error', (e) => {
        loggers.tv.error('Direct stream video error', { event: e, errorCode: video.error?.code });
      });

      hls.attachMedia(video);
      hls.loadSource(streamUrl);
      
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari has native HLS support
      video.src = streamUrl;
      
      video.addEventListener('loadedmetadata', () => {
        video.play().then(() => {
          setIsPlaying(true);
          setIsLoading(false);
          setIsBuffering(false);
        }).catch(error => {
          loggers.tv.error('Safari direct stream error', { error });
          setIsLoading(false);
          setIsBuffering(false);
        });
      });

      video.addEventListener('error', () => {
        loggers.tv.error('Safari direct stream playback error');
        setIsLoading(false);
        setIsBuffering(false);
      });
    } else {
      loggers.tv.error('HLS is not supported in this browser for direct stream');
      setIsLoading(false);
      setIsBuffering(false);
    }
  };

  const handleChannelSelect = async (channel: UnifiedChannel) => {

    // Prevent multiple simultaneous channel selections
    if (isLoading) {
      return;
    }

    try {
      // Set loading state and selected channel immediately for instant feedback
      setIsLoading(true);
      setIsBuffering(true);
      setQueuePosition(null);
      setSelectedChannel(channel);

      // Release current HDHomeRun session in background (don't await - let it happen async)
      if (currentSession) {
        releaseCurrentSession().catch(err => loggers.tv.error('Error releasing session', { error: err }));
      }

      // Check if this is a static channel or IPTV channel
      if (channel.source === 'static' || channel.source === 'iptv') {
        // Static channels and IPTV don't need tuner manager, play directly
        loggers.tv.info('Playing channel directly', { source: channel.source, channelName: channel.GuideName });

        let streamUrl = buildApiUrl(channel.URL);

        // For IPTV channels, acquire stream session for tracking
        if (channel.source === 'iptv' && channel.iptvId) {
          await acquireIptvSession(channel.iptvId);
        }

        // On native platforms, IPTV streams need a token for authentication
        if (isNativePlatform() && channel.source === 'iptv' && channel.iptvId) {
          try {
            loggers.tv.debug('Generating stream token for native platform');
            const tokenResponse = await apiRequest('POST', '/api/iptv/generate-token', {
              streamId: channel.iptvId,
              deviceType: getPlatform()
            });
            const { token } = await tokenResponse.json();
            const separator = streamUrl.includes('?') ? '&' : '?';
            streamUrl = `${streamUrl}${separator}token=${token}`;
            loggers.tv.info('Stream token generated for native playback');
          } catch (error) {
            loggers.tv.error('Failed to generate stream token', { error });
            // Continue anyway, might work with session auth
          }
        }

        playStreamDirectly(streamUrl);
        // Don't set isLoading to false here - let HLS events handle it
        return;
      }

      // Release any IPTV session when switching to HDHomeRun
      await releaseIptvSession();

      // Request stream through tuner manager for HDHomeRun channels only
      loggers.tv.info('Requesting stream for HDHomeRun channel', { guideNumber: channel.GuideNumber });
      const res = await fetch(buildApiUrl('/api/tuner/request-stream'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelNumber: channel.GuideNumber }),
        credentials: 'include',
      });

      const data = await res.json();
      loggers.tv.debug('Stream request response', { data });
      
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

      loggers.tv.debug('Stream session established', { session, streamUrl: session.streamUrl });

      // Set a simple 30-second timeout as fallback (not dependent on React state)
      if (playbackTimeoutRef.current) {
        clearTimeout(playbackTimeoutRef.current);
      }
      playbackTimeoutRef.current = setTimeout(() => {
        loggers.tv.debug('30-second fallback timeout - checking if video started');
        // Only release if session still exists and video element shows it's not playing
        if (currentSession && videoRef.current && videoRef.current.paused && videoRef.current.currentTime === 0) {
          loggers.tv.warn('Video never started playing, releasing session as fallback');
          releaseCurrentSession();
        } else {
          loggers.tv.debug('Video appears to be working, keeping session');
        }
      }, 30000);

      // Clear timeout when video starts playing
      const handleCanPlay = () => {
        if (playbackTimeoutRef.current) {
          loggers.tv.debug('Video can play - clearing playback timeout');
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
          loggers.tv.debug('Destroying existing HLS instance for new channel', { stack: new Error().stack });
          hlsRef.current.destroy();
          hlsRef.current = null;
        }
        
        if (Hls.isSupported()) {
          // Use HLS.js for browsers that support it
          const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: false, // Disabled for stability (prevents buffering)
            startPosition: -1, // Start at live edge
            liveSyncDuration: 6, // Stay 6 seconds behind live edge for stability
            liveMaxLatencyDuration: 15, // Max drift before seeking to live
            backBufferLength: 60, // Increased for smoother playback
            maxBufferLength: 60, // Match native app settings
            maxMaxBufferLength: 120, // Allow more buffer room
            maxBufferSize: 120 * 1000 * 1000, // 120MB
            maxBufferHole: 0.8, // Higher tolerance for buffer holes
            nudgeOffset: 0.2, // Better stall recovery
            nudgeMaxRetry: 5,
            fragLoadingTimeOut: 30000,
            manifestLoadingTimeOut: 20000,
            manifestLoadingMaxRetry: 4,
            manifestLoadingRetryDelay: 1000,
            debug: false,
            fragLoadingMaxRetry: 6,
            fragLoadingRetryDelay: 1000,
            startFragPrefetch: true,
            progressive: true,
            liveDurationInfinity: true,
          });
          
          hlsRef.current = hls;
          
          hls.on(Hls.Events.MEDIA_ATTACHED, () => {
            loggers.tv.debug('HLS media attached');
          });

          // Track if we've started playback to avoid duplicate play() calls
          let playbackStarted = false;

          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            loggers.tv.debug('HLS manifest parsed');
            // Don't start playback here - wait for FRAG_BUFFERED for faster startup
          });

          // Wait for sufficient buffer before starting playback (prevents initial buffering)
          let fragmentsBuffered = 0;
          const MIN_FRAGMENTS_BEFORE_PLAY = 2; // Wait for ~12 seconds of buffer (2 x 6s segments)

          hls.on(Hls.Events.FRAG_BUFFERED, () => {
            fragmentsBuffered++;

            if (!playbackStarted && fragmentsBuffered >= MIN_FRAGMENTS_BEFORE_PLAY) {
              playbackStarted = true;
              loggers.tv.debug('Sufficient buffer ready, starting playback', { fragmentsBuffered });
              setIsLoading(false);

              // Try to play the video with detailed error handling
              const playPromise = video.play();

              if (playPromise !== undefined) {
                playPromise.then(() => {
                  loggers.tv.info('Video started playing successfully');
                  setIsPlaying(true);
                }).catch(error => {
                  loggers.tv.error('Video play promise rejected', { error, errorName: error.name, errorMessage: error.message });

                  // Only release session for genuine fatal errors
                  // Don't release for AbortError or autoplay issues since video might still work
                  if (error.name === 'NotAllowedError') {
                    loggers.tv.debug('Autoplay blocked - user interaction required');
                  } else if (error.name === 'AbortError') {
                    loggers.tv.debug('Video play was aborted - this is usually not fatal, continuing');
                  } else {
                    loggers.tv.warn('Genuine play error - releasing session');
                    releaseCurrentSession();
                  }
                  setIsLoading(false);
                });
              }
            }
          });

          hls.on(Hls.Events.MANIFEST_LOADING, (event, data) => {
            loggers.tv.debug('Loading HLS manifest', { url: data.url, readyState: video.readyState, networkState: video.networkState });
          });

          hls.on(Hls.Events.MANIFEST_LOADED, (event, data) => {
            loggers.tv.debug('HLS manifest loaded successfully', { data, levels: data.levels?.length, url: data.url, readyState: video.readyState });
          });

          hls.on(Hls.Events.LEVEL_LOADING, (event, data) => {
            loggers.tv.debug('HLS level loading', { data });
          });
          hls.on(Hls.Events.LEVEL_LOADED, (event, data) => {
            loggers.tv.debug('HLS level loaded', { data });
          });

          hls.on(Hls.Events.FRAG_LOADING, (event, data) => {
            loggers.tv.debug('Loading HLS fragment', { url: data.frag?.url });
          });

          hls.on(Hls.Events.FRAG_LOADED, (event, data) => {
            loggers.tv.debug('HLS fragment loaded successfully');
          });

          hls.on(Hls.Events.ERROR, (event, data) => {
            loggers.tv.error('HLS error', { data });
            if (data.fatal) {
              switch (data.type) {
                case Hls.ErrorTypes.NETWORK_ERROR:
                  loggers.tv.warn('Fatal network error, trying to recover');
                  hls.startLoad();
                  break;
                case Hls.ErrorTypes.MEDIA_ERROR:
                  loggers.tv.warn('Fatal media error, trying to recover');
                  hls.recoverMediaError();
                  break;
                default:
                  loggers.tv.error('Fatal error, cannot recover - releasing session');
                  // Release session on fatal errors
                  if (currentSession) {
                    releaseCurrentSession();
                  }
                  loggers.tv.debug('Destroying HLS instance due to fatal error', { stack: new Error().stack });
                  hls.destroy();
                  setIsLoading(false);
                  break;
              }
            }
          });

          // Add video event listeners
          video.addEventListener('play', () => {
            loggers.tv.debug('Video play event fired');
            setIsPlaying(true);
          });
          video.addEventListener('pause', () => {
            loggers.tv.debug('Video pause event fired');
            setIsPlaying(false);
          });
          video.addEventListener('volumechange', () => {
            setVolume(video.volume);
            setIsMuted(video.muted);
          });
          video.addEventListener('contextmenu', (e) => e.preventDefault());
          video.addEventListener('loadstart', () => {
            loggers.tv.debug('Video loadstart event');
            video.controls = false;
          });
          video.addEventListener('loadedmetadata', () => {
            loggers.tv.debug('Video loadedmetadata event');
            video.controls = false;
          });
          video.addEventListener('canplay', () => {
            loggers.tv.debug('Video canplay event');
            video.controls = false;
            // Don't auto-play here - let FRAG_BUFFERED handler control playback timing
          });
          video.addEventListener('error', (e) => {
            loggers.tv.error('Video element error', { event: e, errorCode: video.error?.code, errorMessage: video.error?.message });
          });

          video.addEventListener('waiting', () => {
            loggers.tv.debug('IPTV video buffering started');
            setIsBuffering(true);
          });

          video.addEventListener('playing', () => {
            loggers.tv.debug('IPTV video playing after buffering');
            setIsBuffering(false);
          });


          loggers.tv.debug('Loading HLS source', { streamUrl: session.streamUrl });

          // Test direct access to manifest before HLS loading
          loggers.tv.debug('Testing direct manifest access', { streamUrl: session.streamUrl });
          fetch(session.streamUrl)
            .then(response => {
              loggers.tv.debug('Direct fetch success', { status: response.status, statusText: response.statusText, headers: [...response.headers.entries()] });
              return response.text();
            })
            .then(content => {
              loggers.tv.debug('Manifest content preview', { content: content.substring(0, 200) });
            })
            .catch(error => {
              loggers.tv.error('Direct fetch failed', { error });
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
              loggers.tv.error('Error playing video', { error });
              releaseCurrentSession();
              setIsLoading(false);
            });
          };

          const handleError = () => {
            loggers.tv.error('Safari HLS playback error');
            releaseCurrentSession();
            setIsLoading(false);
          };
          
          video.addEventListener('loadedmetadata', handleLoadedMetadata);
          video.addEventListener('error', handleError);
        } else {
          loggers.tv.error('HLS is not supported in this browser');
          releaseCurrentSession();
          setIsLoading(false);
        }
      }
    } catch (error: any) {
      loggers.tv.error('Error starting stream', { error, stack: error?.stack });
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
        const res = await fetch(buildApiUrl('/api/tuner/heartbeat'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId }),
          credentials: 'include',
        });

        if (!res.ok) {
          loggers.tv.error('Failed to send heartbeat');
          clearInterval(heartbeatIntervalRef.current!);
        }
      } catch (error) {
        loggers.tv.error('Error sending heartbeat', { error });
      }
    }, 30000);
  };

  const releaseCurrentSession = async () => {
    loggers.tv.debug('releaseCurrentSession called', { currentSession, stack: new Error().stack });
    if (!currentSession) return;

    try {
      // Stop heartbeat
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }

      // Release session
      const res = await fetch(buildApiUrl('/api/tuner/release-session'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: currentSession.id }),
        credentials: 'include',
      });

      if (!res.ok) {
        loggers.tv.error('Failed to release session');
      }
    } catch (error) {
      loggers.tv.error('Error releasing session', { error });
    } finally {
      setCurrentSession(null);
    }
  };

  // Release IPTV stream session
  const releaseIptvSession = async () => {
    // Stop IPTV heartbeat
    if (iptvHeartbeatRef.current) {
      clearInterval(iptvHeartbeatRef.current);
      iptvHeartbeatRef.current = null;
    }

    // Release IPTV session
    if (iptvSessionToken.current) {
      try {
        await apiRequest('POST', '/api/iptv/stream/release', {
          sessionToken: iptvSessionToken.current
        });
      } catch (e) {
        loggers.tv.debug('IPTV error releasing stream', { error: e });
      }
      iptvSessionToken.current = null;
    }
  };

  // Acquire IPTV stream session for tracking
  const acquireIptvSession = async (streamId: string) => {
    // Release any existing IPTV session first
    await releaseIptvSession();

    try {
      const platform = getPlatform();
      loggers.tv.debug('IPTV acquiring stream', { platform, isNative: isNativePlatform() });
      const response = await apiRequest('POST', '/api/iptv/stream/acquire', {
        streamId,
        deviceType: platform
      });
      const { sessionToken } = await response.json();
      iptvSessionToken.current = sessionToken;

      // Start IPTV heartbeat every 30 seconds
      iptvHeartbeatRef.current = setInterval(async () => {
        if (iptvSessionToken.current) {
          try {
            await apiRequest('POST', '/api/iptv/stream/heartbeat', {
              sessionToken: iptvSessionToken.current
            });
          } catch (e) {
            loggers.tv.debug('IPTV heartbeat error', { error: e });
          }
        }
      }, 30000);

      loggers.tv.info('IPTV stream session acquired', { platform });
    } catch (e) {
      loggers.tv.debug('IPTV could not acquire stream session', { error: e });
      // Continue anyway - stream might still work for users without subscription
    }
  };

  // Check if at least one source is configured
  const hasHDHomeRun = deviceInfo?.configured === true;
  const hasIPTV = iptvStatus?.configured === true;
  const isAnySourceLoading = deviceLoading;

  if (isAnySourceLoading) {
    return (
      <div className="min-h-screen bg-background">
          <div className="container mx-auto px-4 ">
          <div className="text-center py-12">
            <div className="inline-flex items-center gap-2">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              <span>Loading Live TV sources...</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!hasHDHomeRun && !hasIPTV) {
    return (
      <div className="min-h-screen bg-background">
          <div className="container mx-auto px-4 ">
          <Alert className="max-w-2xl mx-auto mt-8">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              No Live TV sources configured. Please configure HD HomeRun (HDHOMERUN_URL) or Xtream Codes IPTV (XTREAM_SERVER_URL, XTREAM_USERNAME, XTREAM_PASSWORD) in your environment variables.
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  // Custom hook to fetch current program for a channel
  const useChannelProgram = (channelName: string, source: 'hdhomerun' | 'iptv' | 'static' = 'hdhomerun') => {
    return useQuery({
      queryKey: ['epg', 'current', channelName, source],
      queryFn: async () => {
        const response = await fetch(`/api/epg/current/${encodeURIComponent(channelName)}`);
        if (!response.ok) {
          throw new Error('Failed to fetch program data');
        }
        const data = await response.json();
        return data.program as EPGProgram | null;
      },
      staleTime: 30 * 1000, // 30 seconds - keep data fresh
      refetchInterval: 30 * 1000, // Refetch every 30 seconds to catch program changes
      enabled: !!channelName
    });
  };

  // Custom hook to fetch upcoming programs for timeline
  const useUpcomingPrograms = (channelName: string, hours: number = 6) => {
    return useQuery({
      queryKey: [`/api/epg/upcoming/${encodeURIComponent(channelName)}?hours=${hours}`],
      queryFn: getQueryFn({ on401: "throw" }),
      select: (data: any) => (data?.programs || []) as EPGProgram[],
      staleTime: 60 * 1000, // 1 minute - refresh timeline more frequently
      refetchInterval: 60 * 1000, // Refetch every minute to keep timeline current
      enabled: !!channelName
    });
  };

  // Current Program component - now receives data as props
  function CurrentProgram({ program, isLoading }: { program?: EPGProgram | null, isLoading?: boolean }) {
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
      <div className="text-sm">
        <div className="font-medium text-foreground">{program.title}</div>
        {program.episodeTitle && <div className="text-muted-foreground">{program.episodeTitle}</div>}
        <div className="text-xs text-muted-foreground">{formatTime(program.startTime, program.endTime)}</div>
      </div>
    );
  }

  // Keyboard shortcut: Ctrl+H to toggle HDHomeRun channels
  // Only show channels that we've loaded EPG data for (infinite scroll)
  let availableChannels = filteredChannels.slice(0, visibleChannelCount);

  // Apply program search filter if search query exists
  // This happens AFTER EPG data is loaded so we can search program titles
  if (searchQuery.trim()) {
    const query = searchQuery.toLowerCase();
    availableChannels = availableChannels.filter(ch => {
      // If channel name/number already matched, keep it
      if (ch.GuideNumber.toLowerCase().includes(query)) return true;
      if (ch.GuideName.toLowerCase().includes(query)) return true;

      // Search by program names in EPG data
      const channelKey = ch.source === 'iptv' ? ch.epgId : ch.GuideNumber;
      if (channelKey) {
        const programs = epgDataMap.get(channelKey) || [];
        const hasMatchingProgram = programs.some(program => {
          // Check program title
          if (program.title?.toLowerCase().includes(query)) return true;
          // Check episode title
          if (program.episodeTitle?.toLowerCase().includes(query)) return true;
          // Check description
          if (program.description?.toLowerCase().includes(query)) return true;
          return false;
        });
        if (hasMatchingProgram) return true;
      }

      return false;
    });
  }

  return (
    <TooltipProvider delayDuration={0}>
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
          {/* Side-by-side layout: Video+Guide on left, Home section on right */}
          <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4 h-[calc(100vh-2rem)] max-h-[calc(100vh-2rem)]">

          {/* Left Side: Video Player + Channel Guide stacked */}
          <div className="flex flex-col gap-4 min-h-0 max-h-full">
            {/* Video Player Section */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="flex-shrink-0"
            >
              {/* Video Player */}
              <Card className="bg-card border">
                <CardContent className="p-0">
                  <div
                    ref={fullscreenContainerRef}
                    className={cn(
                      "relative bg-black overflow-hidden cursor-pointer aspect-video",
                      isFullscreen ? "w-full h-full flex items-center justify-center" : "w-full rounded-b-lg"
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
                      controlsList="nodownload"
                      crossOrigin="anonymous"
                      disablePictureInPicture={false}
                      {...({ 'x-webkit-airplay': 'allow' } as any)}
                    >
                      Your browser does not support the video tag.
                    </video>

                    {/* Buffering Indicator */}
                    {(isBuffering || isLoading) && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-50">
                        <div className="flex flex-col items-center gap-3">
                          <Loader2 className="h-12 w-12 animate-spin text-white" />
                          <p className="text-white text-sm font-medium">
                            {isLoading ? 'Loading stream...' : 'Buffering...'}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Channel Info Overlay - Shows on hover */}
                    {selectedChannel && (
                      <div className={cn(
                        "absolute top-0 left-0 right-0 bg-gradient-to-b from-black/80 via-black/40 to-transparent",
                        "transition-opacity duration-300 pointer-events-none",
                        showControls || !isPlaying ? "opacity-100" : "opacity-0"
                      )}>
                        <div className={cn(
                          "flex items-center justify-between p-4",
                          isFullscreen && "p-6"
                        )}>
                          <div className="flex items-center gap-3">
                            <div className="flex items-center gap-2">
                              {(() => {
                                // For IPTV channels, use the logo property directly
                                let channelLogo = selectedChannel.logo;

                                // For HDHomeRun channels, use the mapping
                                if (!channelLogo && selectedChannel.source === 'hdhomerun') {
                                  const getChannelLogo = (guideNumber: string, guideName: string) => {
                                    const channelToLogoMapping: Record<string, string> = {
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
                                  channelLogo = CHANNEL_LOGOS[logoKey];
                                }

                                return (
                                  <div className="h-12 w-12 rounded flex items-center justify-center overflow-hidden flex-shrink-0 bg-black/30">
                                    {channelLogo ? (
                                      <img
                                        src={channelLogo}
                                        alt={selectedChannel.GuideName}
                                        className="w-full h-full object-contain"
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
                              <div className="text-lg font-bold text-white truncate">{selectedChannel.GuideName}</div>
                              <div className="text-sm text-white/80">
                                {selectedChannelProgramLoading ? (
                                  "Loading current show..."
                                ) : selectedChannelProgram ? (
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <div className="font-medium">{selectedChannelProgram.title}</div>
                                      {selectedChannelProgram.isNew && (
                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400 font-medium leading-none">
                                          New
                                        </span>
                                      )}
                                    </div>
                                    {selectedChannelProgram.episodeTitle && (
                                      <div className="text-xs text-white/60">{selectedChannelProgram.episodeTitle}</div>
                                    )}
                                  </div>
                                ) : (
                                  "Live Television"
                                )}
                              </div>
                            </div>
                          </div>
                          {currentSession && (
                            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-500/20 border border-green-500/40 flex-shrink-0">
                              <div className="h-2 w-2 bg-green-400 rounded-full animate-pulse flex-shrink-0"></div>
                              <span className="text-sm font-medium text-green-300 leading-none">Live</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

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

                          {/* Cast Button */}
                          <button
                            onClick={(e) => { e.stopPropagation(); handleCast(); }}
                            className={cn(
                              "flex items-center justify-center bg-white/20 hover:bg-white/30 rounded-full backdrop-blur-sm transition-colors",
                              isFullscreen ? "w-12 h-12" : "w-10 h-10",
                              isCasting && "bg-blue-500/40"
                            )}
                            title={isCasting ? "Stop casting" : "Cast to device"}
                          >
                            <Cast className={cn("text-white", isFullscreen ? "w-6 h-6" : "w-5 h-5")} />
                          </button>

                          {/* Picture-in-Picture Button */}
                          {isPiPSupported && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handlePiP(); }}
                              className={cn(
                                "flex items-center justify-center bg-white/20 hover:bg-white/30 rounded-full backdrop-blur-sm transition-colors",
                                isFullscreen ? "w-12 h-12" : "w-10 h-10"
                              )}
                              title="Picture-in-Picture"
                            >
                              <PictureInPicture2 className={cn("text-white", isFullscreen ? "w-6 h-6" : "w-5 h-5")} />
                            </button>
                          )}

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

            {/* Channel Guide - Below Video Player */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.4 }}
              className="flex-1 min-h-0"
            >
              <Card className="bg-card border h-full flex flex-col">
                <CardHeader className="pb-3 flex-shrink-0">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <input
                        type="text"
                        placeholder="Search channels..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full px-3 py-2 pl-9 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <Tv className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    </div>
                    {userPackages.length > 0 && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className="w-44 justify-between">
                            <span className="flex items-center gap-2">
                              <Filter className="h-4 w-4" />
                              {selectedPackageIds.size === 0
                                ? "All Packages"
                                : `${selectedPackageIds.size} Package${selectedPackageIds.size > 1 ? 's' : ''}`}
                            </span>
                            <ChevronDown className="h-4 w-4 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-56 p-2" align="end">
                          <div className="space-y-2">
                            <div
                              className="flex items-center gap-2 p-2 hover:bg-accent rounded cursor-pointer"
                              onClick={() => setSelectedPackageIds(new Set())}
                            >
                              <Checkbox
                                checked={selectedPackageIds.size === 0}
                                onCheckedChange={() => setSelectedPackageIds(new Set())}
                              />
                              <span className="text-sm font-medium">All Packages</span>
                            </div>
                            <div className="border-t pt-2">
                              {userPackages.map(pkg => (
                                <div
                                  key={pkg.packageId}
                                  className="flex items-center gap-2 p-2 hover:bg-accent rounded cursor-pointer"
                                  onClick={() => {
                                    setSelectedPackageIds(prev => {
                                      const next = new Set(prev);
                                      if (next.has(pkg.packageId)) {
                                        next.delete(pkg.packageId);
                                      } else {
                                        next.add(pkg.packageId);
                                      }
                                      return next;
                                    });
                                  }}
                                >
                                  <Checkbox
                                    checked={selectedPackageIds.has(pkg.packageId)}
                                    onCheckedChange={() => {
                                      setSelectedPackageIds(prev => {
                                        const next = new Set(prev);
                                        if (next.has(pkg.packageId)) {
                                          next.delete(pkg.packageId);
                                        } else {
                                          next.add(pkg.packageId);
                                        }
                                        return next;
                                      });
                                    }}
                                  />
                                  <span className="text-sm">{pkg.packageName}</span>
                                  <span className="text-xs text-muted-foreground ml-auto">
                                    {pkg.channelCount}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="pt-0 flex-1 overflow-hidden">
                  <div ref={setChannelListRef} className="h-full overflow-y-auto">
                    {(channelsLoading || iptvChannelsLoading) ? (
                      Array.from({ length: 10 }).map((_, index) => (
                        <div key={index} className="flex items-center gap-3 p-3 border-b border-border">
                          <Skeleton className="h-12 w-12 rounded" />
                          <div className="flex-1">
                            <Skeleton className="h-4 w-32 mb-2" />
                            <Skeleton className="h-3 w-24" />
                          </div>
                        </div>
                      ))
                    ) : (
                      availableChannels.map((channel) => {
                        const isFavorite = favoriteChannels.some(fav => fav.channelId === (channel.iptvId || channel.GuideNumber));
                        const channelKey = channel.iptvId || channel.GuideNumber;
                        const programs = epgDataMap.get(channelKey) || [];
                        return (
                          <ChannelGuideRow
                            key={`${channel.source}-${channel.GuideNumber}`}
                            channel={channel}
                            selectedChannel={selectedChannel}
                            onChannelSelect={handleChannelSelect}
                            programs={programs}
                            isLoading={false}
                            onToggleFavorite={handleToggleFavorite}
                            isFavorite={isFavorite}
                          />
                        );
                      })
                    )}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </div>

          {/* Right Side: Home Section with Favorites and Trending */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="hidden lg:block min-h-0 max-h-full"
          >
            <Card className="bg-card border h-full flex flex-col max-h-full">
              <CardHeader className="pb-3 flex-shrink-0">
                <CardTitle className="text-lg">Watch Now</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6 overflow-y-auto flex-1 min-h-0">
                {/* Favorites Section */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Star className="h-4 w-4 text-yellow-500" />
                    <h3 className="font-semibold text-sm">Favorites</h3>
                  </div>
                  {favoriteChannels.length === 0 ? (
                    <div className="text-center py-6 text-muted-foreground text-sm">
                      <Star className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p>No favorites yet</p>
                      <p className="text-xs mt-1">Right-click a channel to add</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {favoriteChannels.slice(0, 8).map((fav) => {
                        // Use the simple lookup map (same as home page)
                        const channel = channelLookupById.get(fav.channelId);
                        // Get current program directly from favoriteEpgDataMap (keyed by fav.channelId)
                        const currentProgram = favoriteEpgDataMap.get(fav.channelId);

                        return (
                          <div
                            key={fav.channelId}
                            className={cn(
                              "flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors",
                              "hover:bg-accent",
                              selectedChannel?.iptvId === fav.channelId && "bg-accent"
                            )}
                            onClick={() => channel && handleChannelSelect(channel)}
                          >
                            {fav.channelLogo ? (
                              <img
                                src={fav.channelLogo}
                                alt={fav.channelName}
                                className="h-10 w-10 rounded object-contain bg-black/20"
                              />
                            ) : (
                              <div className="h-10 w-10 rounded bg-primary/10 flex items-center justify-center">
                                <Tv className="h-5 w-5 text-primary" />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-sm truncate">{fav.channelName}</p>
                              <p className="text-xs text-muted-foreground truncate">
                                {currentProgram?.title || 'No program info'}
                              </p>
                            </div>
                            <Play className="h-4 w-4 text-muted-foreground" />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Trending Section */}
                {trendingChannels.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <TrendingUp className="h-4 w-4 text-orange-500" />
                      <h3 className="font-semibold text-sm">Trending Now</h3>
                    </div>
                    <div className="space-y-2">
                      {trendingChannels.slice(0, 5).map((trending, index) => {
                        const channel = filteredChannels.find(ch =>
                          ch.iptvId === trending.channelId || ch.GuideNumber === trending.channelId
                        );

                        return (
                          <div
                            key={trending.channelId}
                            className={cn(
                              "flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors",
                              "hover:bg-accent",
                              selectedChannel?.iptvId === trending.channelId && "bg-accent"
                            )}
                            onClick={() => channel && handleChannelSelect(channel)}
                          >
                            <div className="h-8 w-8 rounded-full bg-orange-500/10 flex items-center justify-center text-orange-500 font-bold text-sm">
                              {index + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-sm truncate">{trending.channelName}</p>
                              {trending.viewerCount > 0 && (
                                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <Users className="h-3 w-3" />
                                  <span>{trending.viewerCount} watching</span>
                                </div>
                              )}
                            </div>
                            <Play className="h-4 w-4 text-muted-foreground" />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </motion.div>
    </motion.div>
    </TooltipProvider>
  );
}