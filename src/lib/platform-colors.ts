// Each platform maps to { bg, text } tailwind classes
export interface PlatformStyle {
  bg: string;
  text: string;
}

export const platformStyles: Record<string, PlatformStyle> = {
  netflix: { bg: 'bg-platform-netflix', text: 'text-white' },
  exxen: { bg: 'bg-platform-exxen', text: 'text-black' },
  gain: { bg: 'bg-platform-gain', text: 'text-black' },
  'disney-plus': { bg: 'bg-platform-disney', text: 'text-white' },
  'prime-video': { bg: 'bg-platform-prime', text: 'text-white' },
  // canonical streaming_providers slug
  'amazon-prime-video': { bg: 'bg-platform-prime', text: 'text-white' },
  tod: { bg: 'bg-platform-tod', text: 'text-yellow-400' },
  'tod-tv': { bg: 'bg-platform-tod', text: 'text-yellow-400' },
  tabii: { bg: 'bg-platform-tabii', text: 'text-green-400' },
  mubi: { bg: 'bg-platform-mubi', text: 'text-white' },
  'bein-connect': { bg: 'bg-platform-bein', text: 'text-white' },
  'hbo-max': { bg: 'bg-platform-hbo', text: 'text-black' },
  // canonical streaming_providers slug for HBO Max
  max: { bg: 'bg-platform-hbo', text: 'text-black' },
  puhutv: { bg: 'bg-platform-puhutv', text: 'text-black' },
  'tv-plus': { bg: 'bg-platform-tvplus', text: 'text-white' },
  'dsmart-go': { bg: 'bg-platform-dsmart', text: 'text-white' },
};

export function getPlatformStyle(slug: string): PlatformStyle {
  return platformStyles[slug] || { bg: 'bg-primary', text: 'text-primary-foreground' };
}

export const statusLabels: Record<string, string> = {
  yayinda: 'Yayında',
  yakinda: 'Yakında',
  bitti: 'Bitti',
};

export const statusColors: Record<string, string> = {
  yayinda: 'bg-green-500/20 text-green-400',
  yakinda: 'bg-accent/20 text-accent',
  bitti: 'bg-muted-foreground/20 text-muted-foreground',
};
