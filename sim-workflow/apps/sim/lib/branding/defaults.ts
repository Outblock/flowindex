import type { BrandConfig } from './types'

/**
 * Default brand configuration values
 */
export const defaultBrandConfig: BrandConfig = {
  name: 'FlowIndex Studio',
  logoUrl: undefined,
  faviconUrl: '/favicon/favicon.ico',
  customCssUrl: undefined,
  supportEmail: undefined,
  documentationUrl: undefined,
  termsUrl: undefined,
  privacyUrl: undefined,
  theme: {
    primaryColor: '#00EF8B',
    primaryHoverColor: '#00D67D',
    accentColor: '#00C9A7',
    accentHoverColor: '#00B396',
    backgroundColor: '#0c0c0c',
  },
}
