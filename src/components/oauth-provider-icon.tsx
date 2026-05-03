import type { LucideIcon } from 'lucide-react'
import { BadgeDollarSign, Cloud, KeyRound, Linkedin, PanelsTopLeft, Slack } from 'lucide-react'
import {
  type SimpleIcon,
  siApple,
  siAtlassian,
  siDiscord,
  siDropbox,
  siFacebook,
  siFigma,
  siGithub,
  siGitlab,
  siGoogle,
  siHuggingface,
  siKakao,
  siKick,
  siLine,
  siLinear,
  siNaver,
  siNotion,
  siPaypal,
  siPolars,
  siRailway,
  siReddit,
  siRoblox,
  siSpotify,
  siTiktok,
  siTwitch,
  siVercel,
  siVk,
  siWechat,
  siX,
  siZoom,
} from 'simple-icons'

const simpleIcons = {
  apple: siApple,
  atlassian: siAtlassian,
  discord: siDiscord,
  dropbox: siDropbox,
  facebook: siFacebook,
  figma: siFigma,
  github: siGithub,
  gitlab: siGitlab,
  google: siGoogle,
  huggingface: siHuggingface,
  kakao: siKakao,
  kick: siKick,
  line: siLine,
  linear: siLinear,
  naver: siNaver,
  notion: siNotion,
  paypal: siPaypal,
  polar: siPolars,
  railway: siRailway,
  reddit: siReddit,
  roblox: siRoblox,
  spotify: siSpotify,
  tiktok: siTiktok,
  twitch: siTwitch,
  twitter: siX,
  vercel: siVercel,
  vk: siVk,
  wechat: siWechat,
  zoom: siZoom,
} satisfies Record<string, SimpleIcon>

const lucideIcons = {
  cognito: KeyRound,
  linkedin: Linkedin,
  microsoft: PanelsTopLeft,
  paybin: BadgeDollarSign,
  salesforce: Cloud,
  slack: Slack,
} satisfies Record<string, LucideIcon>

export function hasOAuthProviderIcon(icon: string): boolean {
  return icon in simpleIcons || icon in lucideIcons
}

export function OAuthProviderIcon({ icon, name }: { icon: string; name: string }) {
  const simpleIcon = simpleIcons[icon as keyof typeof simpleIcons]
  if (simpleIcon) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4 shrink-0" fill="currentColor">
        <path d={simpleIcon.path} />
      </svg>
    )
  }

  const Icon = lucideIcons[icon as keyof typeof lucideIcons]
  if (Icon) return <Icon aria-hidden="true" className="size-4 shrink-0" />

  return (
    <span aria-hidden="true" className="inline-flex size-4 shrink-0 items-center justify-center text-xs font-semibold">
      {name.trim().charAt(0).toUpperCase()}
    </span>
  )
}
