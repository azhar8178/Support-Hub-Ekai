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
  KbArticleSummary,
  ListKbArticlesCategory,
  ListKbArticlesParams,
  getListKbArticlesQueryKey,
  useListKbArticles,
} from '@workspace/api-client-react';
import { EmptyView, ErrorView, LoadingView } from '@/components/StateViews';
import { KB_CATEGORY_META, kbCategoryLabel } from '@/components/kb';
import { useColors } from '@/hooks/useColors';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useScreenInsets } from '@/hooks/useWebInsets';

const CATEGORY_FILTERS: (ListKbArticlesCategory | 'all')[] = [
  'all',
  ...Object.values(ListKbArticlesCategory),
];

function ArticleCard({ article, onPress }: { article: KbArticleSummary; onPress: () => void }) {
  const colors = useColors();
  const meta = KB_CATEGORY_META[article.category];
  return (
    <Pressable
      testID={`kb-article-${article.id}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <View style={styles.cardTop}>
        <Feather name={meta.icon} size={15} color={colors.accent} />
        <Text style={[styles.cardCategory, { color: colors.mutedForeground }]}>
          {kbCategoryLabel(article.category)}
        </Text>
      </View>
      <Text style={[styles.cardTitle, { color: colors.foreground }]} numberOfLines={2}>
        {article.title}
      </Text>
      <Text style={[styles.cardExcerpt, { color: colors.mutedForeground }]} numberOfLines={2}>
        {article.excerpt}
      </Text>
      {article.helpfulCount > 0 ? (
        <View style={styles.cardFooter}>
          <Feather name="thumbs-up" size={12} color={colors.mutedForeground} />
          <Text style={[styles.cardHelpful, { color: colors.mutedForeground }]}>
            {article.helpfulCount} found this helpful
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export default function HelpScreen() {
  const colors = useColors();
  const insets = useScreenInsets();
  const router = useRouter();

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<ListKbArticlesCategory | 'all'>('all');
  const debouncedSearch = useDebouncedValue(search, 300);

  const params = useMemo(() => {
    const p: ListKbArticlesParams = {};
    if (debouncedSearch.trim()) p.search = debouncedSearch.trim();
    if (category !== 'all') p.category = category;
    return p;
  }, [debouncedSearch, category]);

  const articles = useListKbArticles(params, {
    query: {
      queryKey: getListKbArticlesQueryKey(params),
      placeholderData: (prev) => prev,
    },
  });

  const hasFilters = search.trim().length > 0 || category !== 'all';

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Help Center</Text>
        <Text style={[styles.headerSubtitle, { color: colors.mutedForeground }]}>
          Answers and guides from the Ekai team
        </Text>

        <View
          style={[styles.searchBox, { backgroundColor: colors.muted, borderRadius: colors.radius }]}
        >
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            testID="kb-search-input"
            style={[styles.searchInput, { color: colors.foreground }]}
            placeholder="Search help articles"
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
          {CATEGORY_FILTERS.map((cat) => {
            const active = category === cat;
            return (
              <Pressable
                key={cat}
                testID={`kb-category-${cat}`}
                onPress={() => {
                  Haptics.selectionAsync();
                  setCategory(cat);
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
                  {cat === 'all' ? 'All topics' : kbCategoryLabel(cat)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {articles.isLoading ? (
        <LoadingView />
      ) : articles.isError ? (
        <ErrorView message="Couldn't load help articles." onRetry={() => articles.refetch()} />
      ) : (
        <FlatList
          data={articles.data ?? []}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <ArticleCard article={item} onPress={() => router.push(`/kb/${item.id}`)} />
          )}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 32 }]}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={articles.isRefetching}
              onRefresh={() => articles.refetch()}
              tintColor={colors.accent}
            />
          }
          ListEmptyComponent={
            <EmptyView
              icon="book-open"
              title={hasFilters ? 'No matching articles' : 'No articles yet'}
              subtitle={
                hasFilters
                  ? 'Try a different search or topic.'
                  : 'Help articles will appear here once published.'
              }
            />
          }
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
    gap: 10,
    paddingBottom: 10,
  },
  headerTitle: {
    fontSize: 26,
    fontFamily: 'Inter_700Bold',
  },
  headerSubtitle: {
    fontSize: 13.5,
    fontFamily: 'Inter_400Regular',
    marginTop: -6,
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
  card: {
    borderWidth: 1,
    padding: 14,
    gap: 5,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cardCategory: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
  cardTitle: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    lineHeight: 20,
  },
  cardExcerpt: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    lineHeight: 18,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 3,
  },
  cardHelpful: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
});
