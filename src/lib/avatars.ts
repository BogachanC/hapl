import { Popcorn, Film, Tv, Ghost, Rocket, Cat, Coffee, Star, type LucideIcon } from "lucide-react";

export interface AvatarOption {
  key: string;
  Icon: LucideIcon;
  label: string;
}

export const AVATAR_OPTIONS: AvatarOption[] = [
  { key: "popcorn", Icon: Popcorn, label: "Patlamış mısır" },
  { key: "film", Icon: Film, label: "Film" },
  { key: "tv", Icon: Tv, label: "TV" },
  { key: "ghost", Icon: Ghost, label: "Hayalet" },
  { key: "rocket", Icon: Rocket, label: "Roket" },
  { key: "cat", Icon: Cat, label: "Kedi" },
  { key: "coffee", Icon: Coffee, label: "Kahve" },
  { key: "star", Icon: Star, label: "Yıldız" },
];

export function getAvatarByKey(key: string | null): AvatarOption | undefined {
  if (!key) return undefined;
  return AVATAR_OPTIONS.find((a) => a.key === key);
}

export function getInitial(username: string | null, email: string | undefined): string {
  const source = username || email || "?";
  return source.charAt(0).toUpperCase();
}
