import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import {
  getListKbArticlesQueryKey,
  getListTicketsQueryKey,
  useCreateTicket,
  useGetTicketConfig,
  useListKbArticles,
  useRecordKbSearch,
  useRecordKbSuggestionEvents,
} from '@workspace/api-client-react';
import { NEUTRAL_BADGE, SEVERITY_META } from '@/components/TicketBadges';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { kbCategoryLabel } from '@/components/kb';
import { useColors } from '@/hooks/useColors';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useScreenInsets } from '@/hooks/useWebInsets';

const SEVERITY_HELP: Record<string, string> = {
  P1: 'Production down, no workaround',
  P2: 'Major feature impaired',
  P3: 'Minor issue or question',
  P4: 'Low impact / cosmetic',
};

// crypto.randomUUID isn't guaranteed in Hermes; a random draft-session id is enough here.
function makeDraftId(): string {
  return `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

export default function NewTicketScreen() {
  const colors = useColors();
  const insets = useScreenInsets();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState('');
  const [category, setCategory] = useState('');
  const [environment, setEnvironment] = useState('');
  const [error, setError] = useState<string | null>(null);

  const config = useGetTicketConfig();
  const categories = config.data?.categories ?? [];
  const environments = config.data?.environments ?? [];
  const severities = config.data?.severities ?? [];

  // Seed the pickers with sensible defaults once the live config arrives.
  useEffect(() => {
    if (!config.data) return;
    setSeverity((prev) => prev || severities[Math.floor(severities.length / 2)]?.key || severities[0]?.key || '');
    setCategory((prev) => prev || categories[0]?.key || '');
    setEnvironment((prev) => prev || environments[0]?.key || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.data]);

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

  const canSubmit =
    title.trim().length > 0 &&
    description.trim().length > 0 &&
    severity.length > 0 &&
    category.length > 0 &&
    environment.length > 0 &&
    !createTicket.isPending;

  const debouncedTitle = useDebouncedValue(title.trim(), 350);
  const kbSearchEnabled = debouncedTitle.length >= 3;
  const kbParams = useMemo(() => ({ search: debouncedTitle }), [debouncedTitle]);
  const suggestions = useListKbArticles(kbParams, {
    query: {
      queryKey: getListKbArticlesQueryKey(kbParams),
      enabled: kbSearchEnabled,
      placeholderData: (prev) => prev,
    },
  });
  const suggestedArticles = kbSearchEnabled ? (suggestions.data ?? []).slice(0, 3) : [];

  // Deflection tracking: one draft session per screen visit.
  const [draftId] = useState(makeDraftId);
  const recordEvents = useRecordKbSuggestionEvents();
  const seenArticleIds = useRef<Set<number>>(new Set());
  const clickedArticleIds = useRef<Set<number>>(new Set());

  // Content-gap tracking: log the latest settled search (and how many
  // suggestions it returned) so admins can spot topics with no helpful article.
  const recordSearch = useRecordKbSearch();
  const lastLoggedSearch = useRef<string>('');
  useEffect(() => {
    if (!kbSearchEnabled || !suggestions.isSuccess || suggestions.isPlaceholderData) return;
    const resultCount = (suggestions.data ?? []).length;
    const key = `${debouncedTitle}|${resultCount}`;
    if (lastLoggedSearch.current === key) return;
    lastLoggedSearch.current = key;
    recordSearch.mutate({ data: { draftId, query: debouncedTitle, resultCount } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kbSearchEnabled, debouncedTitle, suggestions.isSuccess, suggestions.isPlaceholderData, suggestions.data]);

  const suggestedIdsKey = suggestedArticles.map((a) => a.id).join(',');
  useEffect(() => {
    const newIds = suggestedArticles
      .map((a) => a.id)
      .filter((id) => !seenArticleIds.current.has(id));
    if (newIds.length === 0) return;
    newIds.forEach((id) => seenArticleIds.current.add(id));
    recordEvents.mutate({
      data: {
        draftId,
        events: newIds.map((articleId) => ({ articleId, eventType: 'impression' as const })),
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestedIdsKey]);

  const onSuggestionPress = (articleId: number) => {
    if (!clickedArticleIds.current.has(articleId)) {
      clickedArticleIds.current.add(articleId);
      recordEvents.mutate({
        data: { draftId, events: [{ articleId, eventType: 'click' as const }] },
      });
    }
    router.push(`/kb/${articleId}`);
  };

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
        // Link the draft when suggestions appeared OR a search was logged, so
        // zero-suggestion drafts that still filed a ticket count as settled.
        kbDraftId:
          seenArticleIds.current.size > 0 || lastLoggedSearch.current !== ''
            ? draftId
            : undefined,
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

        {suggestedArticles.length > 0 ? (
          <View
            style={[
              styles.suggestBox,
              { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius },
            ]}
          >
            <View style={styles.suggestHeader}>
              <Feather name="book-open" size={14} color={colors.accent} />
              <Text style={[styles.suggestTitle, { color: colors.foreground }]}>
                These articles might help
              </Text>
            </View>
            {suggestedArticles.map((article, i) => (
              <Pressable
                key={article.id}
                testID={`kb-suggestion-${article.id}`}
                onPress={() => onSuggestionPress(article.id)}
                style={({ pressed }) => [
                  styles.suggestItem,
                  {
                    borderTopColor: colors.border,
                    borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <View style={styles.suggestItemText}>
                  <Text
                    style={[styles.suggestItemTitle, { color: colors.foreground }]}
                    numberOfLines={1}
                  >
                    {article.title}
                  </Text>
                  <Text style={[styles.suggestItemMeta, { color: colors.mutedForeground }]}>
                    {kbCategoryLabel(article.category)}
                  </Text>
                </View>
                <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
              </Pressable>
            ))}
          </View>
        ) : null}

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

        {config.isLoading ? (
          <View testID="config-loading" style={styles.configLoading}>
            <ActivityIndicator size="small" color={colors.accent} />
            <Text style={[styles.configLoadingText, { color: colors.mutedForeground }]}>
              Loading options
            </Text>
          </View>
        ) : (
          <>
            <Text style={[styles.label, { color: colors.foreground }]}>Severity</Text>
            <View style={styles.severityGrid}>
              {severities.map((sev) => {
                const meta = SEVERITY_META[sev.key] ?? { label: sev.label, ...NEUTRAL_BADGE };
                const active = severity === sev.key;
                return (
                  <Pressable
                    key={sev.key}
                    testID={`severity-option-${sev.key}`}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setSeverity(sev.key);
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
                      {sev.label}
                    </Text>
                    <Text
                      style={[
                        styles.severityHelp,
                        { color: active ? meta.fg : colors.mutedForeground },
                      ]}
                      numberOfLines={2}
                    >
                      {SEVERITY_HELP[sev.key] ?? (sev.isUrgent ? 'Urgent response required' : 'Standard response')}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={[styles.label, { color: colors.foreground }]}>Category</Text>
            <View style={styles.chipWrap}>
              {categories.map((cat) => {
                const active = category === cat.key;
                return (
                  <Pressable
                    key={cat.key}
                    testID={`category-option-${cat.key}`}
                    onPress={() => setCategory(cat.key)}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: active ? '#0F1F3D' : colors.background,
                        borderColor: active ? '#0F1F3D' : colors.border,
                      },
                    ]}
                  >
                    <Text style={[styles.chipText, { color: active ? '#FFFFFF' : colors.mutedForeground }]}>
                      {cat.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={[styles.label, { color: colors.foreground }]}>Environment</Text>
            <View style={styles.chipWrap}>
              {environments.map((env) => {
                const active = environment === env.key;
                return (
                  <Pressable
                    key={env.key}
                    testID={`environment-option-${env.key}`}
                    onPress={() => setEnvironment(env.key)}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: active ? colors.accent : colors.background,
                        borderColor: active ? colors.accent : colors.border,
                      },
                    ]}
                  >
                    <Text style={[styles.chipText, { color: active ? '#FFFFFF' : colors.mutedForeground }]}>
                      {env.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}

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
  configLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 20,
  },
  configLoadingText: {
    fontSize: 13.5,
    fontFamily: 'Inter_500Medium',
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
  suggestBox: {
    borderWidth: 1,
    marginTop: 4,
  },
  suggestHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 4,
  },
  suggestTitle: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  suggestItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  suggestItemText: {
    flex: 1,
    gap: 1,
  },
  suggestItemTitle: {
    fontSize: 13.5,
    fontFamily: 'Inter_500Medium',
  },
  suggestItemMeta: {
    fontSize: 11.5,
    fontFamily: 'Inter_400Regular',
  },
});
