/**
 * PPV Parser Service
 * Parses IPTV channel names to extract structured event data
 *
 * Handles patterns like:
 * - US (Paramount 050) | uefa_europa_league: Fenerbahce vs. Aston Villa (2026-01-22 13:00:05)
 * - US (Peacock 001) | Won's Slalom Run 1 (2026-01-13 12:15:00)
 * - US (ESPN+ 049) | Court 13 (Qualifying) Jan 13 6:00PM ET (2026-01-13 18:01:00)
 */

export type EventCategory =
  | 'nfl'
  | 'nba'
  | 'mlb'
  | 'nhl'
  | 'soccer'
  | 'basketball'
  | 'wrestling'
  | 'winter'
  | 'motorsports'
  | 'tennis'
  | 'golf'
  | 'other';

export interface ParsedEvent {
  channelId: number;
  streamId: string;
  channelName: string;        // Original channel name
  network: string;            // "Paramount", "Peacock", "ESPN+", "MAX"
  networkNumber: string;      // "050", "001"
  league: string | null;      // "uefa_europa_league", "serie_a", etc.
  eventName: string;          // "Fenerbahce vs. Aston Villa"
  category: EventCategory;    // Derived from league/keywords
  startTime: Date;
  endTime?: Date;             // Estimated based on sport duration
  teams?: { home: string; away: string };
  streamUrl: string;
  logo?: string;
  providerId: number;
  // For display
  progress?: number;          // 0-100 percentage through event
  timeRemaining?: string;     // e.g. "45 min left"
  isLive?: boolean;
  // ESPN integration
  espnGameId?: string;
  espnRecapUrl?: string;
  score?: { home: number; away: number };
  finalScore?: { home: number; away: number };
}

// Category mapping from league names to categories
const CATEGORY_MAP: Record<string, EventCategory> = {
  // Soccer
  'uefa_europa_league': 'soccer',
  'uefa_champions_league': 'soccer',
  'serie_a': 'soccer',
  'laliga': 'soccer',
  'la_liga': 'soccer',
  'mls': 'soccer',
  'premier_league': 'soccer',
  'scottish': 'soccer',
  'carabao': 'soccer',
  'carabao_cup': 'soccer',
  'english_football_league': 'soccer',
  'liga_mx': 'soccer',

  // US Sports
  'nfl': 'nfl',
  'nba': 'nba',
  'mlb': 'mlb',
  'nhl': 'nhl',

  // College Basketball
  'big_east': 'basketball',
  'big_12': 'basketball',
  'big_ten': 'basketball',
  'ncaa': 'basketball',
  'sec': 'basketball',
  'acc': 'basketball',
  'pac_12': 'basketball',

  // Wrestling/MMA
  'aew': 'wrestling',
  'wwe': 'wrestling',
  'ufc': 'wrestling',
  'pbr': 'wrestling',
  'bellator': 'wrestling',
  'unrivaled': 'wrestling',

  // Winter Sports
  'slalom': 'winter',
  'snowboard': 'winter',
  'moguls': 'winter',
  'figure_skating': 'winter',
  'ski': 'winter',
  'skating': 'winter',
  'alpine': 'winter',
  'freestyle': 'winter',
  'aerials': 'winter',

  // Motorsports
  'supercross': 'motorsports',
  'tour_down_under': 'motorsports',
  'nascar': 'motorsports',
  'f1': 'motorsports',
  'indycar': 'motorsports',
  'motogp': 'motorsports',

  // Tennis
  'australian_open': 'tennis',
  'us_open': 'tennis',
  'wimbledon': 'tennis',
  'french_open': 'tennis',
  'atp': 'tennis',
  'wta': 'tennis',

  // Golf
  'pga': 'golf',
  'lpga': 'golf',
  'masters': 'golf',
};

// Sport duration estimates in minutes for calculating end time
const SPORT_DURATIONS: Record<EventCategory, number> = {
  nfl: 210,        // ~3.5 hours
  nba: 150,        // ~2.5 hours
  mlb: 180,        // ~3 hours
  nhl: 150,        // ~2.5 hours
  soccer: 120,     // ~2 hours
  basketball: 150, // ~2.5 hours
  wrestling: 180,  // ~3 hours
  winter: 120,     // ~2 hours
  motorsports: 180,// ~3 hours
  tennis: 180,     // ~3 hours (varies a lot)
  golf: 300,       // ~5 hours
  other: 120,      // Default 2 hours
};

/**
 * Parse a PPV channel name to extract event details
 */
export function parseEventChannel(channel: {
  id: number;
  streamId: string;
  name: string;
  logo?: string | null;
  providerId: number;
}): ParsedEvent | null {
  const { id, streamId, name, logo, providerId } = channel;

  // Pattern 1: US (Network XXX) | league: Event Name (YYYY-MM-DD HH:MM:SS)
  const pattern1 = /^[A-Z]{2}\s*\(([^)]+)\s+(\d+)\)\s*\|\s*([^:]+):\s*(.+?)\s*\((\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\)$/;

  // Pattern 2: US (Network XXX) | Event Name (YYYY-MM-DD HH:MM:SS)
  const pattern2 = /^[A-Z]{2}\s*\(([^)]+)\s+(\d+)\)\s*\|\s*(.+?)\s*\((\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\)$/;

  let match = name.match(pattern1);
  let league: string | null = null;
  let eventName: string;
  let network: string;
  let networkNumber: string;
  let dateStr: string;

  if (match) {
    network = match[1].trim();
    networkNumber = match[2];
    league = match[3].trim().toLowerCase().replace(/\s+/g, '_');
    eventName = match[4].trim();
    dateStr = match[5];
  } else {
    match = name.match(pattern2);
    if (!match) {
      return null; // Doesn't match PPV pattern
    }
    network = match[1].trim();
    networkNumber = match[2];
    eventName = match[3].trim();
    dateStr = match[4];
  }

  // Parse the date
  const startTime = new Date(dateStr.replace(' ', 'T') + 'Z');
  if (isNaN(startTime.getTime())) {
    return null; // Invalid date
  }

  // Determine category
  const category = determineCategory(league, eventName, network);

  // Estimate end time based on sport
  const durationMinutes = SPORT_DURATIONS[category];
  const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000);

  // Try to extract teams from event name
  const teams = extractTeams(eventName);

  // Calculate if live and progress
  const now = new Date();
  const isLive = now >= startTime && now <= endTime;
  let progress: number | undefined;
  let timeRemaining: string | undefined;

  if (isLive) {
    const elapsed = now.getTime() - startTime.getTime();
    const total = endTime.getTime() - startTime.getTime();
    progress = Math.min(100, Math.round((elapsed / total) * 100));

    const remainingMs = endTime.getTime() - now.getTime();
    const remainingMin = Math.round(remainingMs / 60000);
    if (remainingMin > 60) {
      const hours = Math.floor(remainingMin / 60);
      const mins = remainingMin % 60;
      timeRemaining = `${hours}h ${mins}m left`;
    } else {
      timeRemaining = `${remainingMin} min left`;
    }
  }

  return {
    channelId: id,
    streamId,
    channelName: name,
    network,
    networkNumber,
    league,
    eventName,
    category,
    startTime,
    endTime,
    teams,
    streamUrl: `/api/iptv/stream/${streamId}.m3u8`,
    logo: logo || undefined,
    providerId,
    progress,
    timeRemaining,
    isLive,
  };
}

/**
 * Determine the category based on league, event name, and network
 */
function determineCategory(
  league: string | null,
  eventName: string,
  network: string
): EventCategory {
  // First check if league maps directly
  if (league && CATEGORY_MAP[league]) {
    return CATEGORY_MAP[league];
  }

  // Check event name keywords
  const eventLower = eventName.toLowerCase();
  const networkLower = network.toLowerCase();

  // NHL detection
  if (eventLower.includes('nhl') || eventLower.includes('hockey') ||
      eventLower.includes('bruins') || eventLower.includes('rangers') ||
      eventLower.includes('maple leafs') || eventLower.includes('kraken')) {
    return 'nhl';
  }

  // NBA detection
  if (eventLower.includes('nba') ||
      eventLower.includes('lakers') || eventLower.includes('celtics') ||
      eventLower.includes('warriors') || eventLower.includes('thunder') ||
      eventLower.includes('knicks') || eventLower.includes('bucks')) {
    return 'nba';
  }

  // NFL detection
  if (eventLower.includes('nfl') || eventLower.includes('football')) {
    return 'nfl';
  }

  // MLB detection
  if (eventLower.includes('mlb') || eventLower.includes('baseball')) {
    return 'mlb';
  }

  // Soccer detection
  if (eventLower.includes(' vs ') || eventLower.includes(' v ') || eventLower.includes(' vs. ')) {
    // Many soccer matches use "vs" format
    if (eventLower.includes('fc') || eventLower.includes('united') ||
        eventLower.includes('city') || eventLower.includes('real') ||
        eventLower.includes('inter') || eventLower.includes('milan')) {
      return 'soccer';
    }
  }

  // Basketball (college)
  if (eventLower.includes('basketball') ||
      eventLower.includes('big east') || eventLower.includes('big 12') ||
      networkLower.includes('espn')) {
    // Could be college basketball
    if (eventLower.includes(' vs ') || eventLower.includes(' at ')) {
      return 'basketball';
    }
  }

  // Wrestling/MMA detection
  if (eventLower.includes('aew') || eventLower.includes('wwe') ||
      eventLower.includes('dynamite') || eventLower.includes('collision') ||
      eventLower.includes('ufc') || eventLower.includes('fight')) {
    return 'wrestling';
  }

  // Winter sports detection
  if (eventLower.includes('slalom') || eventLower.includes('snowboard') ||
      eventLower.includes('skating') || eventLower.includes('mogul') ||
      eventLower.includes('ski') || eventLower.includes('alpine')) {
    return 'winter';
  }

  // Motorsports detection
  if (eventLower.includes('supercross') || eventLower.includes('race') ||
      eventLower.includes('nascar') || eventLower.includes('f1') ||
      eventLower.includes('tour')) {
    return 'motorsports';
  }

  // Tennis detection
  if (eventLower.includes('open') || eventLower.includes('tennis') ||
      eventLower.includes('court') || eventLower.includes('qualifying')) {
    return 'tennis';
  }

  // Golf detection
  if (eventLower.includes('pga') || eventLower.includes('golf') ||
      eventLower.includes('lpga') || eventLower.includes('masters')) {
    return 'golf';
  }

  return 'other';
}

/**
 * Extract team names from event name
 */
function extractTeams(eventName: string): { home: string; away: string } | undefined {
  // Common patterns: "Team A vs Team B", "Team A vs. Team B", "Team A v Team B", "Team A at Team B"
  const patterns = [
    /^(.+?)\s+vs\.?\s+(.+)$/i,
    /^(.+?)\s+v\s+(.+)$/i,
    /^(.+?)\s+at\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = eventName.match(pattern);
    if (match) {
      return {
        away: match[1].trim(),
        home: match[2].trim(),
      };
    }
  }

  return undefined;
}

/**
 * Check if a channel name matches PPV/event pattern
 */
export function isEventChannel(channelName: string): boolean {
  // Must match pattern: XX (Network XXX) | ...
  return /^[A-Z]{2}\s*\([^)]+\s+\d+\)\s*\|/.test(channelName);
}

/**
 * Get the status of an event based on its start/end time
 */
export function getEventStatus(event: ParsedEvent): 'live' | 'upcoming' | 'past' {
  const now = new Date();

  if (event.endTime && now > event.endTime) {
    return 'past';
  }

  if (now >= event.startTime) {
    return 'live';
  }

  return 'upcoming';
}

/**
 * Filter events by category
 */
export function filterEventsByCategory(
  events: ParsedEvent[],
  category: EventCategory | 'all'
): ParsedEvent[] {
  if (category === 'all') {
    return events;
  }
  return events.filter(e => e.category === category);
}

/**
 * Sort events by start time (upcoming first, then live, then past)
 */
export function sortEvents(events: ParsedEvent[]): {
  live: ParsedEvent[];
  upcoming: ParsedEvent[];
  past: ParsedEvent[];
} {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const live: ParsedEvent[] = [];
  const upcoming: ParsedEvent[] = [];
  const past: ParsedEvent[] = [];

  for (const event of events) {
    const status = getEventStatus(event);

    if (status === 'live') {
      live.push(event);
    } else if (status === 'upcoming') {
      upcoming.push(event);
    } else if (status === 'past' && event.startTime >= sevenDaysAgo) {
      // Only include past events from the last 7 days
      past.push(event);
    }
  }

  // Sort by start time
  live.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  upcoming.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  past.sort((a, b) => b.startTime.getTime() - a.startTime.getTime()); // Most recent first

  return { live, upcoming, past };
}

export const ppvParserService = {
  parseEventChannel,
  isEventChannel,
  getEventStatus,
  filterEventsByCategory,
  sortEvents,
};
