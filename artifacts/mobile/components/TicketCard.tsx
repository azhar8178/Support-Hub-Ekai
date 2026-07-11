import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Ticket } from '@workspace/api-client-react';
import { SeverityBadge, StatusBadge } from '@/components/TicketBadges';
import { useColors } from '@/hooks/useColors';
import { timeAgo } from '@/lib/format';

export function TicketCard({ ticket, showOrg }: { ticket: Ticket; showOrg: boolean }) {
  const colors = useColors();
  const router = useRouter();
  const breached = ticket.sla.responseBreached || ticket.sla.resolutionBreached;

  return (
    <Pressable
      testID={`ticket-card-${ticket.id}`}
      onPress={() => {
        Haptics.selectionAsync();
        router.push(`/ticket/${ticket.id}`);
      }}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius + 4,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={styles.badgeRow}>
        <SeverityBadge severity={ticket.severity} small />
        <StatusBadge status={ticket.status} small />
        <View style={styles.flexSpacer} />
        {breached ? <Feather name="alert-triangle" size={15} color="#DC2626" /> : null}
      </View>

      <Text style={[styles.title, { color: colors.cardForeground }]} numberOfLines={2}>
        {ticket.title}
      </Text>

      <View style={styles.metaRow}>
        <Text style={[styles.meta, { color: colors.mutedForeground }]} numberOfLines={1}>
          #{ticket.id}
          {showOrg ? `  ·  ${ticket.orgName}` : ''}
          {`  ·  ${timeAgo(ticket.createdAt)}`}
        </Text>
      </View>

      <View style={styles.assigneeRow}>
        <Feather
          name="user"
          size={13}
          color={ticket.assignedToName ? colors.mutedForeground : '#B45309'}
        />
        <Text
          style={[
            styles.meta,
            { color: ticket.assignedToName ? colors.mutedForeground : '#B45309' },
          ]}
          numberOfLines={1}
        >
          {ticket.assignedToName ?? 'Unassigned'}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    padding: 14,
    gap: 8,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  flexSpacer: {
    flex: 1,
  },
  title: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    lineHeight: 21,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  meta: {
    fontSize: 12.5,
    fontFamily: 'Inter_400Regular',
  },
  assigneeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
});
