import { ISPMappingConfig } from './types.js';

export const ISP_MAPPINGS: ISPMappingConfig[] = [
  {
    name: 'AT&T',
    matches: ['AT&T', 'ATT', 'AT and T', 'AT&T Internet'],
    iconPath: '/isp-logos/at_t_internet_101x101.png'
  },
  {
    name: 'T-Mobile',
    matches: ['T-Mobile', 'TMobile', 'T Mobile'],
    iconPath: '/isp-logos/tmobile_101x101.png'  // Updated to use consistent naming format
  },
  {
    name: 'Verizon',
    matches: ['Verizon', 'Verizon Fios', 'Verizon Business', 'Verizon Wireless'],
    iconPath: '/isp-logos/verizon_fios_101x101.png'
  },
  {
    name: 'Comcast',
    matches: ['Comcast', 'Comcast Business', 'Xfinity'],
    iconPath: '/isp-logos/comcast_business_101x101.png'
  },
  {
    name: 'Spectrum',
    matches: ['Spectrum', 'Charter', 'Charter Communications', 'Spectrum Business'],
    iconPath: '/isp-logos/spectrum_101x101.png'
  },
  {
    name: 'Cox',
    matches: ['Cox', 'Cox Communications', 'Cox Business'],
    iconPath: '/isp-logos/cox_communications_101x101.png'
  },
  {
    name: 'CenturyLink',
    matches: ['CenturyLink', 'Lumen', 'CenturyLink Business'],
    iconPath: '/isp-logos/centurylink_101x101.png'
  },
  {
    name: 'Frontier',
    matches: ['Frontier', 'Frontier Communications'],
    iconPath: '/isp-logos/frontier_communications_101x101.png'
  },
  {
    name: 'RCN',
    matches: ['RCN'],
    iconPath: '/isp-logos/rcn_101x101.png'
  },
  {
    name: 'HughesNet',
    matches: ['HughesNet', 'Hughes Network Systems'],
    iconPath: '/isp-logos/hughesnet_101x101.png'
  },
  {
    name: 'Viasat',
    matches: ['Viasat', 'ViaSat'],
    iconPath: '/isp-logos/viasat_101x101.png'
  },
  {
    name: 'Starlink',
    matches: ['Starlink', 'SpaceX Starlink'],
    iconPath: '/isp-logos/starlink_101x101.png'
  },
  {
    name: 'Ziply',
    matches: ['Ziply', 'Ziply Fiber'],
    iconPath: '/isp-logos/ziply_fiber_101x101.png'
  },
  {
    name: 'TDS',
    matches: ['TDS', 'TDS Telecom'],
    iconPath: '/isp-logos/tds_telecom_101x101.png'
  },
  {
    name: 'Consolidated',
    matches: ['Consolidated', 'Consolidated Communications'],
    iconPath: '/isp-logos/consolidated_communications_101x101.png'
  },
  {
    name: 'EarthLink',
    matches: ['EarthLink', 'Earthlink'],
    iconPath: '/isp-logos/earthlink_101x101.png'
  },
  {
    name: 'Atlantic Broadband',
    matches: ['Atlantic Broadband'],
    iconPath: '/isp-logos/atlantic_broadband_101x101.png'
  },
  {
    name: 'Cincinnati Bell',
    matches: ['Cincinnati Bell'],
    iconPath: '/isp-logos/cincinnati_bell_101x101.png'
  },
  {
    name: 'Hawaiian Telcom',
    matches: ['Hawaiian Telcom'],
    iconPath: '/isp-logos/hawaiian_telcom_101x101.png'
  },
  {
    name: 'MetroNet',
    matches: ['MetroNet'],
    iconPath: '/isp-logos/metronet_101x101.png'
  },
  {
    name: 'Google Fiber',
    matches: ['Google', 'Google Fiber'],
    iconPath: '/isp-logos/google_fiber_101x101.png'
  },
  {
    name: 'Sparklight',
    matches: ['Sparklight'],
    iconPath: '/isp-logos/sparklight_101x101.png'
  },
  {
    name: 'Sonic',
    matches: ['Sonic'],
    iconPath: '/isp-logos/sonic_101x101.png'
  },
  {
    name: 'Rise Broadband',
    matches: ['Rise Broadband'],
    iconPath: '/isp-logos/rise_broadband_101x101.png'
  },
  {
    name: 'Comporium',
    matches: ['Comporium'],
    iconPath: '/isp-logos/comporium_101x101.png'
  },
  {
    name: 'Midco',
    matches: ['Midco'],
    iconPath: '/isp-logos/midco_101x101.png'
  },
  {
    name: 'Shentel',
    matches: ['Shentel'],
    iconPath: '/isp-logos/shentel_101x101.png'
  },
  {
    name: 'Armstrong',
    matches: ['Armstrong'],
    iconPath: '/isp-logos/armstrong_101x101.png'
  },
  {
    name: 'Zayo',
    matches: ['Zayo'],
    iconPath: '/isp-logos/zayo_101x101.png'
  },
  {
    name: 'Sprint',
    matches: ['Sprint'],
    iconPath: '/isp-logos/sprint_101x101.png'
  },
  {
    name: 'China Telecom',
    matches: ['China Telecom'],
    iconPath: '/isp-logos/china_telecom_101x101.png'
  },
  {
    name: 'Orange',
    matches: ['Orange'],
    iconPath: '/isp-logos/orange_101x101.png'
  },
  {
    name: 'Vodafone',
    matches: ['Vodafone'],
    iconPath: '/isp-logos/vodafone_101x101.png'
  },
  {
    name: 'Telus',
    matches: ['Telus'],
    iconPath: '/isp-logos/telus_101x101.png'
  }
];

// Helper function to find the matching ISP config
export function findISPConfig(ispName: string): ISPMappingConfig | undefined {
  if (!ispName) return undefined;

  const normalizedName = ispName.toLowerCase();
  return ISP_MAPPINGS.find(config => 
    config.matches.some(match => 
      normalizedName.includes(match.toLowerCase())
    )
  );
}