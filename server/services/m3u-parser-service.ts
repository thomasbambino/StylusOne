/**
 * M3U Parser Service
 * Parses M3U playlists to extract channel information
 * Supports standard M3U and extended M3U (M3U8) formats
 */

import fetch from 'node-fetch';
import { loggers } from '../lib/logger';

export interface M3UChannel {
  streamId: string;       // Generated unique ID
  name: string;           // Channel name
  streamUrl: string;      // Direct stream URL
  logo?: string;          // Channel logo (tvg-logo)
  epgId?: string;         // EPG channel ID (tvg-id)
  groupTitle?: string;    // Category/group (group-title)
  tvgName?: string;       // TVG name attribute
}

export interface M3UParseResult {
  channels: M3UChannel[];
  totalCount: number;
  categories: string[];
}

/**
 * Parse M3U content and extract channels
 */
export function parseM3UContent(content: string): M3UParseResult {
  const lines = content.split('\n').map(line => line.trim());
  const channels: M3UChannel[] = [];
  const categoriesSet = new Set<string>();

  let currentInfo: Partial<M3UChannel> | null = null;
  let streamIdCounter = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip empty lines and M3U header
    if (!line || line === '#EXTM3U') {
      continue;
    }

    // Parse EXTINF line
    if (line.startsWith('#EXTINF:')) {
      currentInfo = parseExtInf(line);
      continue;
    }

    // Skip other directives
    if (line.startsWith('#')) {
      continue;
    }

    // This should be a stream URL
    if (currentInfo && (line.startsWith('http://') || line.startsWith('https://') || line.startsWith('rtmp://'))) {
      const channel: M3UChannel = {
        streamId: `m3u_${streamIdCounter++}`,
        name: currentInfo.name || `Channel ${streamIdCounter}`,
        streamUrl: line,
        logo: currentInfo.logo,
        epgId: currentInfo.epgId,
        groupTitle: currentInfo.groupTitle,
        tvgName: currentInfo.tvgName,
      };

      channels.push(channel);

      if (channel.groupTitle) {
        categoriesSet.add(channel.groupTitle);
      }

      currentInfo = null;
    }
  }

  return {
    channels,
    totalCount: channels.length,
    categories: Array.from(categoriesSet).sort(),
  };
}

/**
 * Parse EXTINF line to extract channel metadata
 * Format: #EXTINF:-1 tvg-id="..." tvg-name="..." tvg-logo="..." group-title="...",Channel Name
 */
function parseExtInf(line: string): Partial<M3UChannel> {
  const result: Partial<M3UChannel> = {};

  // Extract attributes using regex
  const tvgIdMatch = line.match(/tvg-id="([^"]*)"/i);
  const tvgNameMatch = line.match(/tvg-name="([^"]*)"/i);
  const tvgLogoMatch = line.match(/tvg-logo="([^"]*)"/i);
  const groupTitleMatch = line.match(/group-title="([^"]*)"/i);

  if (tvgIdMatch) result.epgId = tvgIdMatch[1];
  if (tvgNameMatch) result.tvgName = tvgNameMatch[1];
  if (tvgLogoMatch) result.logo = tvgLogoMatch[1];
  if (groupTitleMatch) result.groupTitle = groupTitleMatch[1];

  // Extract channel name (after the last comma)
  const commaIndex = line.lastIndexOf(',');
  if (commaIndex !== -1) {
    result.name = line.substring(commaIndex + 1).trim();
  }

  // Fallback to tvg-name if no name found
  if (!result.name && result.tvgName) {
    result.name = result.tvgName;
  }

  return result;
}

/**
 * Fetch and parse M3U from URL
 */
export async function fetchAndParseM3U(url: string): Promise<M3UParseResult> {
  loggers.iptv.debug('Fetching M3U', { url });

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; IPTV/1.0)',
    },
    signal: AbortSignal.timeout(30000) as any, // 30 second timeout
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch M3U: ${response.status} ${response.statusText}`);
  }

  const content = await response.text();
  loggers.iptv.debug('Downloaded M3U', { bytes: content.length });

  const result = parseM3UContent(content);
  loggers.iptv.info('Parsed M3U playlist', { channelCount: result.totalCount, categoryCount: result.categories.length });

  return result;
}

/**
 * Fetch XMLTV EPG data from URL
 * Returns channel ID to EPG data mapping
 */
export async function fetchXMLTV(url: string): Promise<Map<string, { name: string; icon?: string }>> {
  loggers.iptv.debug('Fetching XMLTV', { url });

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; IPTV/1.0)',
    },
    signal: AbortSignal.timeout(60000) as any, // 60 second timeout for larger files
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch XMLTV: ${response.status} ${response.statusText}`);
  }

  const content = await response.text();
  loggers.iptv.debug('Downloaded XMLTV', { bytes: content.length });

  // Simple XML parsing for channel info (just extract channel IDs and names)
  const channelMap = new Map<string, { name: string; icon?: string }>();

  // Match <channel id="...">...</channel> blocks
  const channelRegex = /<channel\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/channel>/gi;
  let match;

  while ((match = channelRegex.exec(content)) !== null) {
    const channelId = match[1];
    const channelContent = match[2];

    // Extract display name
    const nameMatch = channelContent.match(/<display-name[^>]*>([^<]+)<\/display-name>/i);
    const iconMatch = channelContent.match(/<icon\s+src="([^"]+)"/i);

    if (nameMatch) {
      channelMap.set(channelId, {
        name: nameMatch[1].trim(),
        icon: iconMatch ? iconMatch[1] : undefined,
      });
    }
  }

  loggers.iptv.info('Parsed XMLTV', { channelCount: channelMap.size });
  return channelMap;
}

export const m3uParserService = {
  parseM3UContent,
  fetchAndParseM3U,
  fetchXMLTV,
};
