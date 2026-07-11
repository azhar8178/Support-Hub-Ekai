import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import {
  TicketCategory,
  TicketEnvironment,
  TicketSeverity,
  getListTicketsQueryKey,
  useCreateTicket,
} from '@workspace/api-client-react';
import { SEVERITY_META } from '@/components/TicketBadges';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useColors } from '@/hooks/useColors';
import { useScreenInsets } from '@/hooks/useWebInsets';

const SEVERITY_HELP: Record<string, string> = {
  [TicketSeverity.P1]: 'Production down, no workaround',
  [TicketSeverity.P2]: 'Major feature impaired',
  [TicketSeverity.P3]: 'Minor issue or question',
  [TicketSeverity.P4]: 'Low impact / cosmetic',
};

const CATEGORIES = Object.values(TicketCategory);
const ENVIRONMENTS = Object.values(TicketEnvironment);

function labelize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, ' ');
}

export default function NewTicketScreen() {
  const colors = useColors();
  const insets = useScreenInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<TicketSeverity>(TicketSeverity.P3);
  const [category, setCategory] = useState<TicketCategory>(TicketCategory.platform);
  const [environment, setEnvironment] = useState<TicketEnvironment>(ENVIRONMENTS[0]);
  const [error, setError] = useState<string | null>(null);

  const createTicket = useCreateTicket({
    mutation: {
      onSuccess: (ticket) => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        queryClient.invalidateQueries({ queryKey: getListTicketsQueryKey() });
        router.back();
        setTimeout(() => router.push(`/ticket/${ticket.id}`), 250);
      },
      onError: () => {
        setError("Couldn't create the ticket. Please try again.");
      },
    },
  });

  const canSubmit = title.trim().length > 0 && description.trim().length > 0 && !createTicket.isPending;

  const onSubmit = () => {
    if (!canSubmit) return;
    setError(null);
    createTicket.mutate({
      data: {
        title: title.trim(),
        description: description.trim(),
        severity,
        category,
        environment,
      },
    });
  };

  const inputStyle = {
    borderColor: colors.input,
    borderRadius: colors.radius,
    color: colors.foreground,
    backgroundColor: colors.background,
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.navBar, { paddingTop: insets.top + 8, borderBottomColor: colors.border }]}>
        <Pressable testID="close-button" onPress={() => router.back()} hitSlop={10} style={styles.navSide}>
          <Feather name="x" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.navTitle, { color: colors.foreground }]}>New Ticket</Text>
        <View style={styles.navSide} />
      </View>

      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
      >
        {error ? (
          <View style={[styles.errorBox, { borderRadius: colors.radius }]}>
            <Feather name="alert-circle" size={15} color="#B91C1C" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <Text style={[styles.label, { color: colors.foreground }]}>Title</Text>
        <TextInput
          testID="title-input"
          style={[styles.input, inputStyle]}
          placeholder="Brief summary of the issue"
          placeholderTextColor={colors.mutedForeground}
          value={title}
          onChangeText={setTitle}
          maxLength={200}
        />

        <Text style={[styles.label, { color: colors.foreground }]}>Description</Text>
        <TextInput
          testID="description-input"
          style={[styles.input, styles.textArea, inputStyle]}
          placeholder="What happened? Include steps to reproduce, error messages, and impact."
          placeholderTextColor={colors.mutedForeground}
          value={description}
          onChangeText={setDescription}
          multiline
          textAlignVertical="top"
        />

        <Text style={[styles.label, { color: colors.foreground }]}>Severity</Text>
        <View style={styles.severityGrid}>
          {Object.values(TicketSeverity).map((sev) => {
            const meta = SEVERITY_META[sev];
            const active = severity === sev;
            return (
              <Pressable
                key={sev}
                testID={`severity-option-${sev}`}
                onPress={() => {
                  Haptics.selectionAsync();
                  setSeverity(sev);
                }}
                style={[
                  styles.severityOption,
                  {
                    backgroundColor: active ? meta.bg : colors.card,
                    borderColor: active ? meta.fg : colors.border,
                    borderRadius: colors.radius,
                  },
                ]}
              >
                <Text style={[styles.severityLabel, { color: active ? meta.fg : colors.foreground }]}>
                  {meta.label}
                </Text>
                <Text
                  style={[
                    styles.severityHelp,
                    { color: active ? meta.fg : colors.mutedForeground },
                  ]}
                  numberOfLines={2}
                >
                  {SEVERITY_HELP[sev]}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.label, { color: colors.foreground }]}>Category</Text>
        <View style={styles.chipWrap}>
          {CATEGORIES.map((cat) => {
            const active = category === cat;
            return (
              <Pressable
                key={cat}
                testID={`category-option-${cat}`}
                onPress={() => setCategory(cat)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: active ? '#0F1F3D' : colors.background,
                    borderColor: active ? '#0F1F3D' : colors.border,
                  },
                ]}
              >
                <Text style={[styles.chipText, { color: active ? '#FFFFFF' : colors.mutedForeground }]}>
                  {labelize(cat)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.label, { color: colors.foreground }]}>Environment</Text>
        <View style={styles.chipWrap}>
          {ENVIRONMENTS.map((env) => {
            const active = environment === env;
            return (
              <Pressable
                key={env}
                testID={`environment-option-${env}`}
                onPress={() => setEnvironment(env)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: active ? colors.accent : colors.background,
                    borderColor: active ? colors.accent : colors.border,
                  },
                ]}
              >
                <Text style={[styles.chipText, { color: active ? '#FFFFFF' : colors.mutedForeground }]}>
                  {labelize(env)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          testID="submit-ticket-button"
          onPress={onSubmit}
          disabled={!canSubmit}
          style={({ pressed }) => [
            styles.submit,
            {
              backgroundColor: colors.accent,
              borderRadius: colors.radius,
              opacity: !canSubmit || pressed ? 0.7 : 1,
            },
          ]}
        >
          {createTicket.isPending ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.submitText}>Create ticket</Text>
          )}
        </Pressable>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  navSide: {
    width: 36,
  },
  navTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
  content: {
    padding: 16,
    gap: 8,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FECACA',
    padding: 10,
  },
  errorText: {
    flex: 1,
    color: '#B91C1C',
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  label: {
    fontSize: 13.5,
    fontFamily: 'Inter_600SemiBold',
    marginTop: 8,
  },
  input: {
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 11,
    fontSize: 14.5,
    fontFamily: 'Inter_400Regular',
  },
  textArea: {
    minHeight: 110,
  },
  severityGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  severityOption: {
    width: '48%',
    flexGrow: 1,
    borderWidth: 1,
    padding: 11,
    gap: 3,
  },
  severityLabel: {
    fontSize: 13.5,
    fontFamily: 'Inter_600SemiBold',
  },
  severityHelp: {
    fontSize: 11.5,
    fontFamily: 'Inter_400Regular',
    lineHeight: 15,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
  chipText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  submit: {
    marginTop: 20,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
});
