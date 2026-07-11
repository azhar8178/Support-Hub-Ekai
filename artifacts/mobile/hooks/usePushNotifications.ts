import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { getListNotificationsQueryKey, useRegisterPushToken } from '@workspace/api-client-react';

const PUSH_TOKEN_STORAGE_KEY = 'ekai.expoPushToken';

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/** Token stored on this device after a successful registration (null if none). */
export async function getStoredPushToken(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(PUSH_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export async function clearStoredPushToken(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PUSH_TOKEN_STORAGE_KEY);
  } catch {
    // best effort
  }
}

function extractTicketId(data: unknown): number | null {
  if (data && typeof data === 'object' && 'ticketId' in data) {
    const raw = (data as { ticketId?: unknown }).ticketId;
    const id = typeof raw === 'string' ? Number(raw) : raw;
    if (typeof id === 'number' && Number.isFinite(id)) return id;
  }
  return null;
}

/**
 * Registers this device for Expo push notifications once the portal user is
 * known (`enabled`), and deep-links to the relevant ticket when a push is
 * tapped. No-ops on web and simulators.
 */
export function usePushNotifications(enabled: boolean) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const registerPushToken = useRegisterPushToken();
  const registrationStarted = useRef(false);
  const mutateRef = useRef(registerPushToken.mutate);
  mutateRef.current = registerPushToken.mutate;

  // Register the device token with the API server after sign-in.
  useEffect(() => {
    if (!enabled || registrationStarted.current) return;
    if (Platform.OS === 'web' || !Device.isDevice) return;
    registrationStarted.current = true;

    (async () => {
      try {
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('default', {
            name: 'Ticket updates',
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
          });
        }

        let { status } = await Notifications.getPermissionsAsync();
        if (status !== 'granted') {
          status = (await Notifications.requestPermissionsAsync()).status;
        }
        if (status !== 'granted') return;

        const projectId =
          Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
        const tokenResponse = await Notifications.getExpoPushTokenAsync(
          projectId ? { projectId } : undefined,
        );
        const token = tokenResponse.data;
        if (!token) return;

        await AsyncStorage.setItem(PUSH_TOKEN_STORAGE_KEY, token);
        mutateRef.current({
          data: { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' },
        });
      } catch (err) {
        // Push is best-effort (e.g. Expo Go on Android doesn't support remote
        // push since SDK 53). The in-app Notifications tab still works.
        console.warn('Push notification registration skipped:', err);
      }
    })();
  }, [enabled]);

  // Refresh the in-app notifications list when a push arrives while the app
  // is in the foreground, so the tab badge and list update without a manual
  // pull-to-refresh.
  useEffect(() => {
    if (Platform.OS === 'web') return;

    const subscription = Notifications.addNotificationReceivedListener(() => {
      queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
    });
    return () => subscription.remove();
  }, [queryClient]);

  // Deep-link to the ticket when the user taps a push notification.
  useEffect(() => {
    if (Platform.OS === 'web') return;

    const openFromResponse = (response: Notifications.NotificationResponse | null) => {
      const ticketId = extractTicketId(response?.notification.request.content.data);
      if (ticketId != null) {
        router.push(`/ticket/${ticketId}`);
      }
    };

    // App launched cold by tapping a notification.
    let cancelled = false;
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (!cancelled) openFromResponse(response);
      })
      .catch(() => undefined);

    // App in foreground/background when the notification is tapped.
    const subscription = Notifications.addNotificationResponseReceivedListener(openFromResponse);
    return () => {
      cancelled = true;
      subscription.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
