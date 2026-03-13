export const FPS = 30;
export const DEFAULT_DURATION_SEC = 15;
export const DEFAULT_DURATION_FRAMES = DEFAULT_DURATION_SEC * FPS;

export const FORMATS = {
  portrait: { width: 1080, height: 1920 }, // 9:16
  square: { width: 1080, height: 1080 }, // 1:1
  landscape: { width: 1920, height: 1080 }, // 16:9
} as const;

export type FormatKey = keyof typeof FORMATS;
