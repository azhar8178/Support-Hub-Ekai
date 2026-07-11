import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Safe-area insets with web fallbacks (the web preview reports 0 insets,
 * but the simulated status bar / home indicator still overlap content).
 */
export function useScreenInsets() {
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === 'web';
  return {
    top: isWeb ? Math.max(insets.top, 67) : insets.top,
    bottom: isWeb ? Math.max(insets.bottom, 34) : insets.bottom,
  };
}
