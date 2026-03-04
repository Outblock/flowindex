import type { Metadata } from 'next'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { getBrandConfig } from '@/ee/whitelabeling/branding'

/**
 * Generate dynamic metadata based on brand configuration
 */
export function generateBrandedMetadata(override: Partial<Metadata> = {}): Metadata {
  const brand = getBrandConfig()

  const defaultTitle = brand.name
  const summaryFull = `FlowIndex Studio is an AI agent workflow builder for the Flow blockchain. Build, deploy, and automate workflows that interact with Flow smart contracts, tokens, NFTs, and on-chain data.`
  const summaryShort = `FlowIndex Studio — AI agent workflow builder for the Flow blockchain.`

  return {
    title: {
      template: `%s | ${brand.name}`,
      default: defaultTitle,
    },
    description: summaryShort,
    applicationName: brand.name,
    authors: [{ name: brand.name }],
    generator: 'Next.js',
    keywords: [
      'Flow blockchain',
      'FlowIndex',
      'AI agent workflow',
      'blockchain automation',
      'Flow smart contracts',
      'Cadence',
      'Flow NFT',
      'Flow tokens',
      'workflow builder',
      'on-chain data',
      'blockchain explorer',
      'Flow EVM',
    ],
    referrer: 'origin-when-cross-origin',
    creator: brand.name,
    publisher: brand.name,
    metadataBase: new URL(getBaseUrl()),
    alternates: {
      canonical: '/',
      languages: {
        'en-US': '/',
      },
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-image-preview': 'large',
        'max-video-preview': -1,
        'max-snippet': -1,
      },
    },
    openGraph: {
      type: 'website',
      locale: 'en_US',
      url: getBaseUrl(),
      title: defaultTitle,
      description: summaryFull,
      siteName: brand.name,
      images: [
        {
          url: brand.logoUrl || '/logo/426-240/primary/small.png',
          width: 2130,
          height: 1200,
          alt: brand.name,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: defaultTitle,
      description: summaryFull,
      images: [brand.logoUrl || '/logo/426-240/primary/small.png'],
      creator: '@flowaboratory',
      site: '@flowaboratory',
    },
    manifest: '/manifest.webmanifest',
    icons: {
      icon: [
        { url: '/favicon/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
        { url: '/favicon/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
        {
          url: '/favicon/favicon-192x192.png',
          sizes: '192x192',
          type: 'image/png',
        },
        {
          url: '/favicon/favicon-512x512.png',
          sizes: '512x512',
          type: 'image/png',
        },
        { url: brand.faviconUrl || '/sim.png', sizes: 'any', type: 'image/png' },
      ],
      apple: '/favicon/apple-touch-icon.png',
      shortcut: brand.faviconUrl || '/favicon/favicon.ico',
    },
    appleWebApp: {
      capable: true,
      statusBarStyle: 'default',
      title: brand.name,
    },
    formatDetection: {
      telephone: false,
    },
    category: 'technology',
    other: {
      'apple-mobile-web-app-capable': 'yes',
      'mobile-web-app-capable': 'yes',
      'msapplication-TileColor': '#00EF8B',
      'msapplication-config': '/favicon/browserconfig.xml',
    },
    ...override,
  }
}

/**
 * Generate static structured data for SEO
 */
export function generateStructuredData() {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'FlowIndex Studio',
    description:
      'FlowIndex Studio is an AI agent workflow builder for the Flow blockchain. Build, deploy, and automate workflows that interact with Flow smart contracts, tokens, NFTs, and on-chain data.',
    url: getBaseUrl(),
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web Browser',
    applicationSubCategory: 'BlockchainAutomation',
    areaServed: 'Worldwide',
    availableLanguage: ['en'],
    offers: {
      '@type': 'Offer',
      category: 'SaaS',
    },
    creator: {
      '@type': 'Organization',
      name: 'FlowIndex',
      url: 'https://flowindex.io',
    },
    featureList: [
      'Flow Blockchain AI Workflows',
      'Visual Workflow Builder',
      'On-Chain Data Automation',
      'Smart Contract Integration',
    ],
  }
}
