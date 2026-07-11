import React, { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

const MONO_FONT = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import {
  KbArticle,
  getGetKbArticleQueryKey,
  getListKbArticlesQueryKey,
  useGetKbArticle,
  useSubmitKbFeedback,
} from '@workspace/api-client-react';
import { ErrorView, LoadingView } from '@/components/StateViews';
import { KB_CATEGORY_META, kbCategoryLabel } from '@/components/kb';
import { useColors } from '@/hooks/useColors';
import { useScreenInsets } from '@/hooks/useWebInsets';

type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'ordered'; index: string; text: string }
  | { kind: 'code'; text: string };

function parseMarkdown(content: string): Block[] {
  const blocks: Block[] = [];
  const lines = content.split('\n');
  let codeBuffer: string[] | null = null;
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
      paragraph = [];
    }
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');

    if (line.trim().startsWith('```')) {
      flushParagraph();
      if (codeBuffer === null) {
        codeBuffer = [];
      } else {
        blocks.push({ kind: 'code', text: codeBuffer.join('\n') });
        codeBuffer = null;
      }
      continue;
    }
    if (codeBuffer !== null) {
      codeBuffer.push(raw);
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      blocks.push({
        kind: 'heading',
        level: heading[1].length as 1 | 2 | 3,
        text: heading[2],
      });
      continue;
    }

    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      flushParagraph();
      blocks.push({ kind: 'bullet', text: bullet[1] });
      continue;
    }

    const ordered = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (ordered) {
      flushParagraph();
      blocks.push({ kind: 'ordered', index: ordered[1], text: ordered[2] });
      continue;
    }

    if (line.trim() === '') {
      flushParagraph();
      continue;
    }

    paragraph.push(line.trim());
  }

  if (codeBuffer !== null && codeBuffer.length > 0) {
    blocks.push({ kind: 'code', text: codeBuffer.join('\n') });
  }
  flushParagraph();
  return blocks;
}

/** Renders inline markdown: **bold** and `code`. */
function InlineText({ text, style }: { text: string; style: object[] }) {
  const colors = useColors();
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return (
    <Text style={style}>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return (
            <Text key={i} style={{ fontFamily: 'Inter_600SemiBold' }}>
              {part.slice(2, -2)}
            </Text>
          );
        }
        if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
          return (
            <Text
              key={i}
              style={{
                fontFamily: MONO_FONT,
                fontSize: 13,
                backgroundColor: colors.muted,
              }}
            >
              {part.slice(1, -1)}
            </Text>
          );
        }
        return <Text key={i}>{part}</Text>;
      })}
    </Text>
  );
}

function MarkdownBody({ content }: { content: string }) {
  const colors = useColors();
  const blocks = parseMarkdown(content);

  return (
    <View style={styles.body}>
      {blocks.map((block, i) => {
        switch (block.kind) {
          case 'heading': {
            const size = block.level === 1 ? 20 : block.level === 2 ? 17.5 : 15.5;
            return (
              <Text
                key={i}
                style={[
                  styles.blockHeading,
                  { color: colors.foreground, fontSize: size },
                ]}
              >
                {block.text}
              </Text>
            );
          }
          case 'code':
            return (
              <View
                key={i}
                style={[
                  styles.codeBlock,
                  { backgroundColor: colors.muted, borderRadius: colors.radius },
                ]}
              >
                <Text style={[styles.codeText, { color: colors.foreground }]}>{block.text}</Text>
              </View>
            );
          case 'bullet':
            return (
              <View key={i} style={styles.listRow}>
                <Text style={[styles.listMarker, { color: colors.mutedForeground }]}>•</Text>
                <InlineText
                  text={block.text}
                  style={[styles.blockParagraph, styles.listText, { color: colors.foreground }]}
                />
              </View>
            );
          case 'ordered':
            return (
              <View key={i} style={styles.listRow}>
                <Text style={[styles.listMarker, { color: colors.mutedForeground }]}>
                  {block.index}.
                </Text>
                <InlineText
                  text={block.text}
                  style={[styles.blockParagraph, styles.listText, { color: colors.foreground }]}
                />
              </View>
            );
          default:
            return (
              <InlineText
                key={i}
                text={block.text}
                style={[styles.blockParagraph, { color: colors.foreground }]}
              />
            );
        }
      })}
    </View>
  );
}

function FeedbackSection({ article }: { article: KbArticle }) {
  const colors = useColors();
  const queryClient = useQueryClient();
  const [voted, setVoted] = useState<'helpful' | 'not_helpful' | null>(null);

  const feedback = useSubmitKbFeedback({
    mutation: {
      onSuccess: (updated) => {
        queryClient.setQueryData(getGetKbArticleQueryKey(article.id), updated);
        queryClient.invalidateQueries({ queryKey: getListKbArticlesQueryKey() });
      },
      onError: () => {
        setVoted(null);
      },
    },
  });

  const vote = (helpful: boolean) => {
    if (voted || feedback.isPending) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setVoted(helpful ? 'helpful' : 'not_helpful');
    feedback.mutate({ id: article.id, data: { helpful } });
  };

  return (
    <View
      style={[
        styles.feedbackBox,
        { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius },
      ]}
    >
      {voted ? (
        <View style={styles.feedbackThanks}>
          <Feather name="check-circle" size={16} color={colors.accent} />
          <Text style={[styles.feedbackTitle, { color: colors.foreground }]}>
            Thanks for your feedback
          </Text>
        </View>
      ) : (
        <>
          <Text style={[styles.feedbackTitle, { color: colors.foreground }]}>
            Was this article helpful?
          </Text>
          <View style={styles.feedbackButtons}>
            <Pressable
              testID="kb-feedback-helpful"
              onPress={() => vote(true)}
              style={({ pressed }) => [
                styles.feedbackButton,
                {
                  borderColor: colors.border,
                  borderRadius: colors.radius,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Feather name="thumbs-up" size={15} color={colors.accent} />
              <Text style={[styles.feedbackButtonText, { color: colors.foreground }]}>Yes</Text>
            </Pressable>
            <Pressable
              testID="kb-feedback-not-helpful"
              onPress={() => vote(false)}
              style={({ pressed }) => [
                styles.feedbackButton,
                {
                  borderColor: colors.border,
                  borderRadius: colors.radius,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Feather name="thumbs-down" size={15} color={colors.mutedForeground} />
              <Text style={[styles.feedbackButtonText, { color: colors.foreground }]}>No</Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

export default function KbArticleScreen() {
  const colors = useColors();
  const insets = useScreenInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const articleId = Number(id);

  const article = useGetKbArticle(articleId);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[styles.navBar, { paddingTop: insets.top + 8, borderBottomColor: colors.border }]}
      >
        <Pressable testID="kb-back-button" onPress={() => router.back()} hitSlop={10} style={styles.navSide}>
          <Feather name="chevron-left" size={24} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.navTitle, { color: colors.foreground }]} numberOfLines={1}>
          Help article
        </Text>
        <View style={styles.navSide} />
      </View>

      {article.isLoading ? (
        <LoadingView />
      ) : article.isError || !article.data ? (
        <ErrorView message="Couldn't load this article." onRetry={() => article.refetch()} />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        >
          <View style={styles.metaRow}>
            <Feather
              name={KB_CATEGORY_META[article.data.category]?.icon ?? 'book-open'}
              size={14}
              color={colors.accent}
            />
            <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
              {kbCategoryLabel(article.data.category)}
            </Text>
            <Text style={[styles.metaDot, { color: colors.mutedForeground }]}>·</Text>
            <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
              Updated{' '}
              {new Date(article.data.updatedAt).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </Text>
          </View>
          <Text style={[styles.title, { color: colors.foreground }]}>{article.data.title}</Text>
          <MarkdownBody content={article.data.content} />
          <FeedbackSection article={article.data} />
        </ScrollView>
      )}
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
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  metaText: {
    fontSize: 12.5,
    fontFamily: 'Inter_500Medium',
  },
  metaDot: {
    fontSize: 12.5,
  },
  title: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    lineHeight: 29,
    marginBottom: 12,
  },
  body: {
    gap: 10,
  },
  blockHeading: {
    fontFamily: 'Inter_600SemiBold',
    marginTop: 8,
  },
  blockParagraph: {
    fontSize: 14.5,
    fontFamily: 'Inter_400Regular',
    lineHeight: 22,
  },
  listRow: {
    flexDirection: 'row',
    gap: 8,
    paddingLeft: 4,
  },
  listMarker: {
    fontSize: 14.5,
    lineHeight: 22,
    fontFamily: 'Inter_500Medium',
  },
  listText: {
    flex: 1,
  },
  codeBlock: {
    padding: 12,
  },
  codeText: {
    fontFamily: MONO_FONT,
    fontSize: 12.5,
    lineHeight: 18,
  },
  feedbackBox: {
    borderWidth: 1,
    padding: 16,
    marginTop: 24,
    gap: 12,
    alignItems: 'center',
  },
  feedbackThanks: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  feedbackTitle: {
    fontSize: 14.5,
    fontFamily: 'Inter_600SemiBold',
  },
  feedbackButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  feedbackButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderWidth: 1,
    paddingHorizontal: 22,
    paddingVertical: 9,
  },
  feedbackButtonText: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
  },
});
