/**
 * Channel Logo Service - Maps channel numbers to logos from TV guide data
 */

export interface ChannelLogoInfo {
  channelNumber: string;
  callSign: string;
  logoUrl: string;
  channelName?: string;
}

/**
 * Service to extract and manage channel logos from TV guide data
 */
export class ChannelLogoService {
  private channelLogos: Map<string, ChannelLogoInfo> = new Map();

  /**
   * Parse TV guide HTML/data and extract channel logos
   */
  parseChannelLogos(htmlData: string): void {
    // Extract channel data using regex patterns to parse the HTML structure
    const channelRowPattern = /<div class="channel-row"[^>]*id="channel_(\d+)"[^>]*>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g;
    const logoPattern = /<img src="([^"]+)"[^>]*>/;
    const metaPattern = /<span class="channel-card__channelNum">([^<]+)<\/span><span class="channel-card__callSign">([^<]+)<\/span>/;

    let match;
    while ((match = channelRowPattern.exec(htmlData)) !== null) {
      const channelBlock = match[0];
      const channelId = match[1];

      // Extract logo URL
      const logoMatch = logoPattern.exec(channelBlock);
      if (!logoMatch) continue;

      let logoUrl = logoMatch[1];
      // Ensure it's a full URL
      if (logoUrl.startsWith('//')) {
        logoUrl = 'https:' + logoUrl;
      }

      // Extract channel metadata
      const metaMatch = metaPattern.exec(channelBlock);
      if (!metaMatch) continue;

      const channelNumber = metaMatch[1].trim();
      const callSign = metaMatch[2].trim();

      // Store the channel logo info
      this.channelLogos.set(channelNumber, {
        channelNumber,
        callSign,
        logoUrl,
        channelName: callSign
      });

      // Also store by call sign for alternative lookups
      this.channelLogos.set(callSign, {
        channelNumber,
        callSign,
        logoUrl,
        channelName: callSign
      });
    }

    console.log(`Parsed ${this.channelLogos.size / 2} channel logos from TV guide data`);
  }

  /**
   * Get logo URL for a channel by number or call sign
   */
  getChannelLogo(channelIdentifier: string): string | null {
    const channelInfo = this.channelLogos.get(channelIdentifier);
    return channelInfo ? channelInfo.logoUrl : null;
  }

  /**
   * Get all channel logo information
   */
  getAllChannelLogos(): ChannelLogoInfo[] {
    const uniqueChannels = new Map<string, ChannelLogoInfo>();
    
    // Filter out duplicates (we store by both channel number and call sign)
    for (const [key, info] of this.channelLogos) {
      if (key === info.channelNumber) {
        uniqueChannels.set(key, info);
      }
    }
    
    return Array.from(uniqueChannels.values()).sort((a, b) => {
      const aNum = parseFloat(a.channelNumber);
      const bNum = parseFloat(b.channelNumber);
      return aNum - bNum;
    });
  }

  /**
   * Find closest matching channel by number (handles sub-channels)
   */
  findChannelByNumber(targetNumber: string): ChannelLogoInfo | null {
    // Try exact match first
    const exact = this.channelLogos.get(targetNumber);
    if (exact) return exact;

    // Try without decimal for sub-channels (e.g., "8.1" -> "8")
    const baseNumber = targetNumber.split('.')[0];
    const base = this.channelLogos.get(baseNumber);
    if (base) return base;

    // Try with .1 suffix for main channels
    const withSub = this.channelLogos.get(targetNumber + '.1');
    if (withSub) return withSub;

    return null;
  }

  /**
   * Clear all stored channel logos
   */
  clear(): void {
    this.channelLogos.clear();
  }

  /**
   * Get count of stored logos
   */
  getLogoCount(): number {
    const uniqueChannels = new Set();
    for (const [key, info] of this.channelLogos) {
      if (key === info.channelNumber) {
        uniqueChannels.add(key);
      }
    }
    return uniqueChannels.size;
  }
}

// Export singleton instance
export const channelLogoService = new ChannelLogoService();