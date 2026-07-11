import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { TicketStatus } from '@workspace/api-client-react';

export type BadgeMeta = { label: string; bg: string; fg: string; border: string };

// Neutral fallback styling for severities that aren't in the static map
// (e.g. a now-retired taxonomy value stored on an older ticket).
export const NEUTRAL_BADGE: Omit<BadgeMeta, 'label'> = {
  bg: '#F1F5F9',
  fg: '#334155',
  border: '#E2E8F0',
};

export const SEVERITY_META: Record<string, BadgeMeta> = {
  P1: { label: 'P1 Critical', bg: '#FEE2E2', fg: '#B91C1C', border: '#FECACA' },
  P2: { label: 'P2 High', bg: '#FFEDD5', fg: '#C2410C', border: '#FED7AA' },
  P3: { label: 'P3 Normal', bg: '#FEF3C7', fg: '#B45309', border: '#FDE68A' },
  P4: { label: 'P4 Low', bg: '#F1F5F9', fg: '#334155', border: '#E2E8F0' },
};

export const STATUS_META: Record<string, BadgeMeta> = {
  [TicketStatus.new]: { label: 'New', bg: '#EFF6FF', fg: '#1D4ED8', border: '#BFDBFE' },
  [TicketStatus.triaged]: { label: 'Triaged', bg: '#F0F9FF', fg: '#0369A1', border: '#BAE6FD' },
  [TicketStatus.in_progress]: { label: 'In Progress', bg: '#EEF2FF', fg: '#4338CA', border: '#C7D2FE' },
  [TicketStatus.awaiting_customer]: { label: 'Awaiting Customer', bg: '#FFFBEB', fg: '#B45309', border: '#FDE68A' },
  [TicketStatus.resolved]: { label: 'Resolved', bg: '#ECFDF5', fg: '#047857', border: '#A7F3D0' },
  [TicketStatus.closed]: { label: 'Closed', bg: '#F1F5F9', fg: '#475569', border: '#E2E8F0' },
};

function Pill({ meta, small }: { meta: BadgeMeta; small?: boolean }) {
  return (
    <View
      style={[
        styles.pill,
        { backgroundColor: meta.bg, borderColor: meta.border },
        small && styles.pillSmall,
      ]}
    >
      <Text style={[styles.pillText, { color: meta.fg }, small && styles.pillTextSmall]}>
        {meta.label}
      </Text>
    </View>
  );
}

export function SeverityBadge({ severity, small }: { severity: string; small?: boolean }) {
  // Fall back to the raw stored key (never blank) with neutral styling when the
  // severity isn't in the static map (e.g. a retired taxonomy value).
  const meta = SEVERITY_META[severity] ?? { label: severity, ...NEUTRAL_BADGE };
  return <Pill meta={meta} small={small} />;
}

export function StatusBadge({ status, small }: { status: TicketStatus; small?: boolean }) {
  const meta = STATUS_META[status] ?? STATUS_META[TicketStatus.new];
  return <Pill meta={meta} small={small} />;
}

const styles = StyleSheet.create({
  pill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  pillSmall: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  pillText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  pillTextSmall: {
    fontSize: 11,
  },
});
