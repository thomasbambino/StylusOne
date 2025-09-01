// Types for ISP icons
export interface ISPIconProps {
  className?: string;
  size?: number;
}

export interface ISPMappingConfig {
  name: string;
  // Array of possible names that should map to this ISP's icon
  matches: string[];
  // Path to the icon asset
  iconPath: string;
}
