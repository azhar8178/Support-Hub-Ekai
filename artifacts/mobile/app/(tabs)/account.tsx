import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useClerk } from '@clerk/expo';
import { useQueryClient } from '@tanstack/react-query';
import { PortalUserRole, useGetCurrentUser } from '@workspace/api-client-react';
import { ErrorView, LoadingView } from '@/components/StateViews';
import { useColors } from '@/hooks/useColors';
import { useScreenInsets } from '@/hooks/useWebInsets';
import { initials } from '@/lib/format';

const ROLE_LABELS: Record<string, string> = {
  [PortalUserRole.customer]: 'Customer',
  [PortalUserRole.ekai_agent]: 'Ekai Agent',
  [PortalUserRole.admin]: 'Administrator',
};

function InfoRow({ icon, label, value }: { icon: keyof typeof Feather.glyphMap; label: string; value: string }) {
  const colors = useColors();
  return (
    <View style={styles.infoRow}>
      <View style={[styles.infoIcon, { backgroundColor: colors.muted }]}>
        <Feather name={icon} size={15} color={colors.mutedForeground} />
      </View>
      <View style={styles.infoBody}>
        <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>{label}</Text>
        <Text style={[styles.infoValue, { color: colors.foreground }]}>{value}</Text>
      </View>
    </View>
  );
}

export default function AccountScreen() {
  const colors = useColors();
  const insets = useScreenInsets();
  const { signOut } = useClerk();
  const queryClient = useQueryClient();
  const me = useGetCurrentUser();

  if (me.isLoading) return <LoadingView />;
  if (me.isError || !me.data) {
    return <ErrorView message="Couldn't load your profile." onRetry={() => me.refetch()} />;
  }

  const user = me.data;
  const isStaff = user.role !== PortalUserRole.customer;

  const onSignOut = async () => {
    queryClient.clear();
    await signOut();
  };

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 32 },
      ]}
    >
      <View style={[styles.avatar, { backgroundColor: '#0F1F3D' }]}>
        <Text style={styles.avatarText}>{initials(user.name)}</Text>
      </View>
      <Text style={[styles.name, { color: colors.foreground }]}>{user.name}</Text>
      <Text style={[styles.email, { color: colors.mutedForeground }]}>{user.email}</Text>

      <View
        style={[
          styles.roleBadge,
          {
            backgroundColor: isStaff ? '#EFF6FF' : colors.muted,
            borderColor: isStaff ? '#BFDBFE' : colors.border,
          },
        ]}
      >
        <Feather
          name={isStaff ? 'shield' : 'user'}
          size={13}
          color={isStaff ? '#1D4ED8' : colors.mutedForeground}
        />
        <Text
          style={[
            styles.roleText,
            { color: isStaff ? '#1D4ED8' : colors.mutedForeground },
          ]}
        >
          {ROLE_LABELS[user.role] ?? user.role}
        </Text>
      </View>

      <View
        style={[
          styles.card,
          { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius + 4 },
        ]}
      >
        <InfoRow icon="briefcase" label="Organisation" value={user.orgName ?? 'Ekai (internal)'} />
        <View style={[styles.cardDivider, { backgroundColor: colors.border }]} />
        <InfoRow
          icon="calendar"
          label="Member since"
          value={new Date(user.createdAt).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        />
      </View>

      <Pressable
        testID="sign-out-button"
        onPress={onSignOut}
        style={({ pressed }) => [
          styles.signOut,
          {
            borderColor: '#FECACA',
            backgroundColor: '#FEF2F2',
            borderRadius: colors.radius,
            opacity: pressed ? 0.8 : 1,
          },
        ]}
      >
        <Feather name="log-out" size={16} color="#B91C1C" />
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  avatar: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 26,
    fontFamily: 'Inter_700Bold',
  },
  name: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
  },
  email: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginTop: 12,
  },
  roleText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  card: {
    alignSelf: 'stretch',
    borderWidth: 1,
    marginTop: 28,
    paddingHorizontal: 14,
  },
  cardDivider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 44,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
  },
  infoIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoBody: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  infoValue: {
    fontSize: 14.5,
    fontFamily: 'Inter_500Medium',
    marginTop: 1,
  },
  signOut: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    paddingVertical: 13,
    marginTop: 24,
  },
  signOutText: {
    color: '#B91C1C',
    fontSize: 14.5,
    fontFamily: 'Inter_600SemiBold',
  },
});
