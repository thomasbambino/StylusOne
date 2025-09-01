// Game artwork mapping system
// Maps game types to their respective artwork/icons

export interface GameArtwork {
  icon: string; // Small icon for badges
  banner: string; // Larger banner/background image
  logo: string; // Game logo
  color: string; // Primary brand color
}

// Game artwork database - uses external URLs for now, can be replaced with local assets
export const gameArtworkMap: Record<string, GameArtwork> = {
  'Minecraft': {
    icon: 'https://cdn.icon-icons.com/icons2/2699/PNG/512/minecraft_logo_icon_168974.png',
    banner: 'https://www.minecraft.net/content/dam/games/minecraft/key-art/Vanilla-PMP_Collection-Carousel-0_Buzzy-Bees_1280x768.jpg',
    logo: 'https://logos-world.net/wp-content/uploads/2020/04/Minecraft-Logo.png',
    color: '#62A844'
  },
  'Satisfactory': {
    icon: 'https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/526870/e373e0e6065ecbc9e0a8b6c3103d8ecd5fd33684.jpg',
    banner: 'https://cdn.cloudflare.steamstatic.com/steam/apps/526870/header.jpg',
    logo: 'https://cdn.cloudflare.steamstatic.com/steam/apps/526870/logo.png',
    color: '#FF6B35'
  },
  'Valheim': {
    icon: 'https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/892970/f75a85ac45d6c9fb4bece728ba6b3e6e58f2ef25.jpg',
    banner: 'https://cdn.cloudflare.steamstatic.com/steam/apps/892970/header.jpg',
    logo: 'https://cdn.cloudflare.steamstatic.com/steam/apps/892970/logo.png',
    color: '#4A5D23'
  },
  'Terraria': {
    icon: 'https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/105600/4a9f63c4ac2c002e80a6b8a5eb200d3b70ff50c4.jpg',
    banner: 'https://cdn.cloudflare.steamstatic.com/steam/apps/105600/header.jpg',
    logo: 'https://cdn.cloudflare.steamstatic.com/steam/apps/105600/logo.png',
    color: '#5D9C59'
  },
  'Rust': {
    icon: 'https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/252490/e80c0b89a46c91cb9c24b5f3c88e9b50d15df94c.jpg',
    banner: 'https://cdn.cloudflare.steamstatic.com/steam/apps/252490/header.jpg',
    logo: 'https://cdn.cloudflare.steamstatic.com/steam/apps/252490/logo.png',
    color: '#CE422B'
  },
  '7 Days to Die': {
    icon: 'https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/251570/f8e4e50d77f53ac9f02bf1e04b91c52f8eaff48d.jpg',
    banner: 'https://cdn.cloudflare.steamstatic.com/steam/apps/251570/header.jpg',
    logo: 'https://cdn.cloudflare.steamstatic.com/steam/apps/251570/logo.png',
    color: '#8B0000'
  },
  'Palworld': {
    icon: 'https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/1623730/966d06e8d4bf80717cbad6af2a945b8b49f64bb1.jpg',
    banner: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1623730/header.jpg',
    logo: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1623730/logo.png',
    color: '#4FC3F7'
  },
  'Enshrouded': {
    icon: 'https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/1203620/9a29315d3b7b52d8dd42bfdc2ad6fb1894f20b93.jpg',
    banner: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1203620/header.jpg',
    logo: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1203620/logo.png',
    color: '#8E24AA'
  },
  'ARK: Survival Evolved': {
    icon: 'https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/346110/2a8e1c5db8f7ee294e6a2b4aa04a8e1a7bff69ba.jpg',
    banner: 'https://cdn.cloudflare.steamstatic.com/steam/apps/346110/header.jpg',
    logo: 'https://cdn.cloudflare.steamstatic.com/steam/apps/346110/logo.png',
    color: '#FF7043'
  },
  'Conan Exiles': {
    icon: 'https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/440900/dc7560a0c325b8d6b3ed7d8ee93aa3fc5cfdbbb0.jpg',
    banner: 'https://cdn.cloudflare.steamstatic.com/steam/apps/440900/header.jpg',
    logo: 'https://cdn.cloudflare.steamstatic.com/steam/apps/440900/logo.png',
    color: '#795548'
  }
};

// Default artwork for unknown games
export const defaultGameArtwork: GameArtwork = {
  icon: 'https://cdn-icons-png.flaticon.com/512/2972/2972531.png', // Generic game controller
  banner: 'https://via.placeholder.com/460x215/374151/ffffff?text=Game+Server',
  logo: 'https://via.placeholder.com/200x80/374151/ffffff?text=Game',
  color: '#374151'
};

/**
 * Get artwork for a specific game type
 * @param gameType The game type string
 * @returns GameArtwork object with all image URLs and color
 */
export function getGameArtwork(gameType: string): GameArtwork {
  // Try exact match first
  if (gameArtworkMap[gameType]) {
    return gameArtworkMap[gameType];
  }

  // Try case-insensitive match
  const lowerGameType = gameType.toLowerCase();
  const matchedKey = Object.keys(gameArtworkMap).find(
    key => key.toLowerCase() === lowerGameType
  );

  if (matchedKey) {
    return gameArtworkMap[matchedKey];
  }

  // Try partial match
  const partialMatch = Object.keys(gameArtworkMap).find(
    key => key.toLowerCase().includes(lowerGameType) || lowerGameType.includes(key.toLowerCase())
  );

  if (partialMatch) {
    return gameArtworkMap[partialMatch];
  }

  // Return default artwork
  return defaultGameArtwork;
}

/**
 * Get the primary color for a game type
 * @param gameType The game type string
 * @returns Hex color string
 */
export function getGameColor(gameType: string): string {
  return getGameArtwork(gameType).color;
}

/**
 * Get game icon URL
 * @param gameType The game type string
 * @returns Icon URL string
 */
export function getGameIcon(gameType: string): string {
  return getGameArtwork(gameType).icon;
}

/**
 * Get game banner/header image URL
 * @param gameType The game type string
 * @returns Banner URL string
 */
export function getGameBanner(gameType: string): string {
  return getGameArtwork(gameType).banner;
}

/**
 * Get game logo URL
 * @param gameType The game type string
 * @returns Logo URL string
 */
export function getGameLogo(gameType: string): string {
  return getGameArtwork(gameType).logo;
}