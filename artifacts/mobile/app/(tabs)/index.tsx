import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  ListTicketsParams,
  TicketSeverity,
  TicketStatus,
  getGetAgentMetricsQueryKey,
  getGetDashboardSummaryQueryKey,
  useGetAgentMetrics,
  useGetCurrentUser,
  useGetDashboardSummary,
  useListTickets,
} from '@workspace/api-client-react';
import { STATUS_META } from '@/components/TicketBadges';
import { TicketCard } from '@/components/TicketCard';
import { EmptyView, ErrorView, LoadingView } from '@/components/StateViews';
import { useColors } from '@/hooks/useColors';
import { useScreenInsets } from '@/hooks/useWebInsets';

const STATUS_FILTERS: { value: TicketStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: TicketStatus.new, label: 'New' },
  { value: TicketStatus.triaged, label: 'Triaged' },
  { value: TicketStatus.in_progress, label: 'In Progress' },
  { value: TicketStatus.awaiting_customer, label: 'Awaiting' },
  { value: TicketStatus.resolved, label: 'Resolved' },
  { value: TicketStatus.closed, label: 'Closed' },
];

const SEVERITY_FILTERS: (TicketSeverity | 'all')[] = [
  'all',
  TicketSeverity.P1,
  TicketSeverity.P2,
  TicketSeverity.P3,
  TicketSeverity.P4,
];

function StatChip({ label, value, alert }: { label: string; value: string | number; alert?: boolean }) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.statChip,
        {
          backgroundColor: alert ? '#FEF2F2' : colors.card,
          borderColor: alert ? '#FECACA' : colors.border,
          borderRadius: colors.radius,
        },
      ]}
    >
      <Text style={[styles.statValue, { color: alert ? '#B91C1C' : colors.foreground }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: alert ? '#B91C1C' : colors.mutedForeground }]}>
        {label}
      </Text>
    </View>
  );
}

export default function TicketsScreen() {
  const colors = useColors();
  const insets = useScreenInsets();
  const router = useRouter();

  const me = useGetCurrentUser();
  const isStaff = me.data?.role === 'ekai_agent' || me.data?.role === 'admin';

  const [statusFilter, setStatusFilter] = useState<TicketStatus | 'all'>('all');
  const [severityFilter, setSeverityFilter] = useState<TicketSeverity | 'all'>('all');
  const [search, setSearch] = useState('');

  const params = useMemo(() => {
    const p: ListTicketsParams = {};
    if (statusFilter !== 'all') p.status = statusFilter;
    if (severityFilter !== 'all') p.severity = severityFilter;
    if (search.trim()) p.search = search.trim();
    return p;
  }, [statusFilter, severityFilter, search]);

  const tickets = useListTickets(params);
  const metrics = useGetAgentMetrics({
    query: { queryKey: getGetAgentMetricsQueryKey(), enabled: isStaff },
  });
  const summary = useGetDashboardSummary({
    query: { queryKey: getGetDashboardSummaryQueryKey(), enabled: me.data?.role === 'customer' },
  });

  const hasFilters = statusFilter !== 'all' || severityFilter !== 'all' || search.trim().length > 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View style={styles.headerRow}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Tickets</Text>
        </View>

        {isStaff && metrics.data ? (
          <View style={styles.statsRow}>
            <StatChip label="Open P1" value={metrics.data.openP1Count} alert={metrics.data.openP1Count > 0} />
            <StatChip
              label="SLA today"
              value={metrics.data.slaBreachesToday}
              alert={metrics.data.slaBreachesToday > 0}
            />
            <StatChip label="Open" value={metrics.data.openTicketCount} />
          </View>
        ) : null}
        {!isStaff && summary.data ? (
          <View style={styles.statsRow}>
            <StatChip label="Open" value={summary.data.openCount} />
            <StatChip label="In progress" value={summary.data.inProgressCount} />
            <StatChip label="Resolved 30d" value={summary.data.resolvedLast30Days} />
          </View>
        ) : null}

        <View
          style={[
            styles.searchBox,
            { backgroundColor: colors.muted, borderRadius: colors.radius },
          ]}
        >
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            testID="ticket-search-input"
            style={[styles.searchInput, { color: colors.foreground }]}
            placeholder="Search tickets"
            placeholderTextColor={colors.mutedForeground}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
          />
          {search ? (
            <Pressable onPress={() => setSearch('')} hitSlop={8}>
              <Feather name="x" size={16} color={colors.mutedForeground} />
            </Pressable>
          ) : null}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {STATUS_FILTERS.map((filter) => {
            const active = statusFilter === filter.value;
            return (
              <Pressable
                key={filter.value}
                testID={`status-filter-${filter.value}`}
                onPress={() => {
                  Haptics.selectionAsync();
                  setStatusFilter(filter.value);
                }}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: active ? '#0F1F3D' : colors.background,
                    borderColor: active ? '#0F1F3D' : colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    { color: active ? '#FFFFFF' : colors.mutedForeground },
                  ]}
                >
                  {filter.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {SEVERITY_FILTERS.map((sev) => {
            const active = severityFilter === sev;
            return (
              <Pressable
                key={sev}
                testID={`severity-filter-${sev}`}
                onPress={() => {
                  Haptics.selectionAsync();
                  setSeverityFilter(sev);
                }}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: active ? colors.accent : colors.background,
                    borderColor: active ? colors.accent : colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    { color: active ? '#FFFFFF' : colors.mutedForeground },
                  ]}
                >
                  {sev === 'all' ? 'All severities' : sev}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {tickets.isLoading ? (
        <LoadingView />
      ) : tickets.isError ? (
        <ErrorView message="Couldn't load tickets." onRetry={() => tickets.refetch()} />
      ) : (
        <FlatList
          data={tickets.data ?? []}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => <TicketCard ticket={item} showOrg={isStaff} />}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 96 }]}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          refreshControl={
            <RefreshControl
              refreshing={tickets.isRefetching}
              onRefresh={() => tickets.refetch()}
              tintColor={colors.accent}
            />
          }
          ListEmptyComponent={
            <EmptyView
              icon="inbox"
              title={hasFilters ? 'No matching tickets' : 'No tickets yet'}
              subtitle={
                hasFilters
                  ? 'Try adjusting your filters or search.'
                  : 'Create your first support ticket to get help from the Ekai team.'
              }
            />
          }
        />
      )}

      <Pressable
        testID="new-ticket-fab"
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          router.push('/new-ticket');
        }}
        style={({ pressed }) => [
          styles.fab,
          {
            backgroundColor: colors.accent,
            bottom: 24,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <Feather name="plus" size={26} color="#FFFFFF" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    gap: 10,
    paddingBottom: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: 26,
    fontFamily: 'Inter_700Bold',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statChip: {
    flex: 1,
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 1,
  },
  statValue: {
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
  },
  statLabel: {
    fontSize: 11.5,
    fontFamily: 'Inter_500Medium',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  searchInput: {
    flex: 1,
    fontSize: 14.5,
    fontFamily: 'Inter_400Regular',
    padding: 0,
  },
  filterRow: {
    gap: 8,
    paddingRight: 16,
  },
  filterChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  filterChipText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
    flexGrow: 1,
  },
  fab: {
    position: 'absolute',
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
});
