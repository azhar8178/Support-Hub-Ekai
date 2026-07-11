import React, { useCallback } from 'react';
import { FlatList, Platform, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import {
  AppNotification,
  getListNotificationsQueryKey,
  useListNotifications,
  useMarkNotificationsRead,
} from '@workspace/api-client-react';
import { EmptyView, ErrorView, LoadingView } from '@/components/StateViews';
import { useColors } from '@/hooks/useColors';
import { useScreenInsets } from '@/hooks/useWebInsets';
import { timeAgo } from '@/lib/format';

const TYPE_ICONS: Record<string, keyof typeof Feather.glyphMap> = {
  ticket_created: 'plus-circle',
  agent_reply: 'message-circle',
  status_changed: 'refresh-cw',
  new_critical_ticket: 'alert-triangle',
  sla_warning: 'clock',
  invite: 'mail',
};

export default function NotificationsScreen() {
  const colors = useColors();
  const insets = useScreenInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const notifications = useListNotifications();
  const markRead = useMarkNotificationsRead({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
      },
    },
  });

  const unreadCount = (notifications.data ?? []).filter((n) => !n.read).length;

  // Opening the tab acknowledges the alerts: clear the app icon badge (native).
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'web') {
        Notifications.setBadgeCountAsync(0).catch(() => undefined);
      }
    }, []),
  );

  const onPressItem = (item: AppNotification) => {
    Haptics.selectionAsync();
    if (!item.read) {
      markRead.mutate({ data: { ids: [item.id] } });
    }
    if (item.ticketId != null) {
      router.push(`/ticket/${item.ticketId}`);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Notifications</Text>
        {unreadCount > 0 ? (
          <Pressable
            testID="mark-all-read-button"
            onPress={() => markRead.mutate({ data: { all: true } })}
            hitSlop={8}
          >
            <Text style={[styles.markAll, { color: colors.accent }]}>Mark all read</Text>
          </Pressable>
        ) : null}
      </View>

      {notifications.isLoading ? (
        <LoadingView />
      ) : notifications.isError ? (
        <ErrorView message="Couldn't load notifications." onRetry={() => notifications.refetch()} />
      ) : (
        <FlatList
          data={notifications.data ?? []}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 24 }]}
          refreshControl={
            <RefreshControl
              refreshing={notifications.isRefetching}
              onRefresh={() => notifications.refetch()}
              tintColor={colors.accent}
            />
          }
          ItemSeparatorComponent={() => (
            <View style={[styles.separator, { backgroundColor: colors.border }]} />
          )}
          ListEmptyComponent={
            <EmptyView
              icon="bell"
              title="No notifications"
              subtitle="Updates about your tickets will show up here."
            />
          }
          renderItem={({ item }) => (
            <Pressable
              testID={`notification-${item.id}`}
              onPress={() => onPressItem(item)}
              style={({ pressed }) => [
                styles.item,
                {
                  backgroundColor: item.read ? colors.background : '#EFF6FF',
                  opacity: pressed ? 0.8 : 1,
                },
              ]}
            >
              <View style={[styles.itemIcon, { backgroundColor: colors.muted }]}>
                <Feather
                  name={TYPE_ICONS[item.type] ?? 'bell'}
                  size={16}
                  color={item.read ? colors.mutedForeground : colors.accent}
                />
              </View>
              <View style={styles.itemBody}>
                <Text
                  style={[
                    styles.itemTitle,
                    {
                      color: colors.foreground,
                      fontFamily: item.read ? 'Inter_500Medium' : 'Inter_600SemiBold',
                    },
                  ]}
                  numberOfLines={2}
                >
                  {item.title}
                </Text>
                <Text style={[styles.itemText, { color: colors.mutedForeground }]} numberOfLines={2}>
                  {item.body}
                </Text>
                <Text style={[styles.itemTime, { color: colors.mutedForeground }]}>
                  {timeAgo(item.createdAt)}
                </Text>
              </View>
              {!item.read ? <View style={[styles.unreadDot, { backgroundColor: colors.accent }]} /> : null}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: 26,
    fontFamily: 'Inter_700Bold',
  },
  markAll: {
    fontSize: 13.5,
    fontFamily: 'Inter_600SemiBold',
    paddingBottom: 5,
  },
  listContent: {
    flexGrow: 1,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 62,
  },
  item: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    alignItems: 'flex-start',
  },
  itemIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  itemBody: {
    flex: 1,
    gap: 2,
  },
  itemTitle: {
    fontSize: 14.5,
  },
  itemText: {
    fontSize: 13.5,
    fontFamily: 'Inter_400Regular',
    lineHeight: 19,
  },
  itemTime: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 8,
  },
});
