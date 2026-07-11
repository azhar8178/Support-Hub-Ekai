import type { ComponentProps } from 'react';
import type { Feather } from '@expo/vector-icons';
import { KbArticleSummaryCategory } from '@workspace/api-client-react';

type FeatherIconName = ComponentProps<typeof Feather>['name'];

export const KB_CATEGORY_META: Record<string, { label: string; icon: FeatherIconName }> = {
  [KbArticleSummaryCategory.getting_started]: { label: 'Getting started', icon: 'play-circle' },
  [KbArticleSummaryCategory.infrastructure_deployment]: {
    label: 'Infrastructure & deployment',
    icon: 'server',
  },
  [KbArticleSummaryCategory.troubleshooting]: { label: 'Troubleshooting', icon: 'tool' },
  [KbArticleSummaryCategory.security_compliance]: {
    label: 'Security & compliance',
    icon: 'shield',
  },
  [KbArticleSummaryCategory.release_notes]: { label: 'Release notes', icon: 'file-text' },
};

export function kbCategoryLabel(category: string): string {
  return (
    KB_CATEGORY_META[category]?.label ??
    category.charAt(0).toUpperCase() + category.slice(1).replace(/_/g, ' ')
  );
}
