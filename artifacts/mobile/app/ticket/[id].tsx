import React, { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import {
  PortalUserRole,
  TicketAttachment,
  TicketMessage,
  TicketStatus,
  getAttachmentContent,
  getGetTicketQueryKey,
  getListTicketsQueryKey,
  useAddTicketAttachment,
  useAddTicketMessage,
  useAssignTicket,
  useChangeTicketStatus,
  useGetCurrentUser,
  useGetTicket,
} from '@workspace/api-client-react';
import { SeverityBadge, StatusBadge, STATUS_META } from '@/components/TicketBadges';
import { ErrorView, LoadingView } from '@/components/StateViews';
import { useColors } from '@/hooks/useColors';
import { useScreenInsets } from '@/hooks/useWebInsets';
import {
  PendingAttachment,
  attachmentIcon,
  formatBytes,
  openAttachmentContent,
  pickDocument,
  pickPhoto,
} from '@/lib/attachments';
import { formatDateTime, initials, timeAgo } from '@/lib/format';

const STATUS_ORDER: TicketStatus[] = [
  TicketStatus.new,
  TicketStatus.triaged,
  TicketStatus.in_progress,
  TicketStatus.awaiting_customer,
  TicketStatus.resolved,
  TicketStatus.closed,
];

function MessageBubble({ message, isStaffViewer }: { message: TicketMessage; isStaffViewer: boolean }) {
  const colors = useColors();
  const fromStaff = message.authorRole !== 'customer';
  const internal = message.isInternal;

  return (
    <View style={styles.messageRow}>
      <View
        style={[
          styles.messageAvatar,
          { backgroundColor: fromStaff ? '#0F1F3D' : colors.muted },
        ]}
      >
        <Text
          style={[
            styles.messageAvatarText,
            { color: fromStaff ? '#FFFFFF' : colors.mutedForeground },
          ]}
        >
          {initials(message.authorName)}
        </Text>
      </View>
      <View
        style={[
          styles.messageBubble,
          {
            backgroundColor: internal ? '#FFFBEB' : colors.card,
            borderColor: internal ? '#FDE68A' : colors.border,
            borderRadius: colors.radius + 4,
          },
        ]}
      >
        <View style={styles.messageHeader}>
          <Text style={[styles.messageAuthor, { color: colors.foreground }]} numberOfLines={1}>
            {message.authorName}
          </Text>
          {internal ? (
            <View style={styles.internalTag}>
              <Feather name="eye-off" size={10} color="#B45309" />
              <Text style={styles.internalTagText}>Internal</Text>
            </View>
          ) : null}
          <Text style={[styles.messageTime, { color: colors.mutedForeground }]}>
            {timeAgo(message.createdAt)}
          </Text>
        </View>
        <Text style={[styles.messageContent, { color: colors.cardForeground }]}>
          {message.content}
        </Text>
      </View>
    </View>
  );
}

function AttachmentRow({
  attachment,
  downloading,
  onPress,
}: {
  attachment: TicketAttachment;
  downloading: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      testID={`attachment-${attachment.id}`}
      onPress={onPress}
      disabled={downloading}
      style={({ pressed }) => [
        styles.attachmentRow,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <View style={[styles.attachmentIconWrap, { backgroundColor: colors.muted }]}>
        <Feather
          name={attachmentIcon(attachment.contentType)}
          size={15}
          color={colors.mutedForeground}
        />
      </View>
      <View style={styles.attachmentInfo}>
        <Text style={[styles.attachmentName, { color: colors.foreground }]} numberOfLines={1}>
          {attachment.filename}
        </Text>
        <Text style={[styles.attachmentMeta, { color: colors.mutedForeground }]}>
          {formatBytes(attachment.sizeBytes)} · {timeAgo(attachment.createdAt)}
        </Text>
      </View>
      {downloading ? (
        <ActivityIndicator size="small" color={colors.accent} />
      ) : (
        <Feather name="download" size={16} color={colors.accent} />
      )}
    </Pressable>
  );
}

export default function TicketDetailScreen() {
  const colors = useColors();
  const insets = useScreenInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const ticketId = Number(id);

  const me = useGetCurrentUser();
  const isStaff = me.data?.role === PortalUserRole.ekai_agent || me.data?.role === PortalUserRole.admin;

  const detail = useGetTicket(ticketId);
  const listRef = useRef<FlatList>(null);

  const [reply, setReply] = useState('');
  const [internalNote, setInternalNote] = useState(false);
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetTicketQueryKey(ticketId) });
    queryClient.invalidateQueries({ queryKey: getListTicketsQueryKey() });
  };

  const addMessage = useAddTicketMessage();
  const addAttachment = useAddTicketAttachment();
  const changeStatus = useChangeTicketStatus({
    mutation: {
      onSuccess: () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        invalidate();
      },
    },
  });
  const assign = useAssignTicket({
    mutation: {
      onSuccess: () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        invalidate();
      },
    },
  });

  const ticket = detail.data?.ticket;
  const messages = detail.data?.messages ?? [];
  const attachments = detail.data?.attachments ?? [];

  const slaState = useMemo(() => {
    if (!ticket) return null;
    if (ticket.sla.responseBreached || ticket.sla.resolutionBreached) {
      return { label: 'SLA breached', bg: '#FEF2F2', fg: '#B91C1C', border: '#FECACA', icon: 'alert-triangle' as const };
    }
    const pct = Math.max(ticket.sla.responsePctElapsed ?? 0, ticket.sla.resolutionPctElapsed ?? 0);
    if (pct >= 80) {
      return { label: 'SLA at risk', bg: '#FFFBEB', fg: '#B45309', border: '#FDE68A', icon: 'clock' as const };
    }
    return null;
  }, [ticket]);

  const onPick = async (kind: 'photo' | 'file') => {
    if (picking) return;
    setPicking(true);
    setComposerError(null);
    try {
      const picked = kind === 'photo' ? await pickPhoto() : await pickDocument();
      if (picked) setPending((prev) => [...prev, picked]);
    } catch (err) {
      setComposerError(err instanceof Error ? err.message : "Couldn't attach that file.");
    } finally {
      setPicking(false);
    }
  };

  const onSend = async () => {
    const content = reply.trim();
    if ((!content && pending.length === 0) || sending) return;
    setSending(true);
    setComposerError(null);
    try {
      let messageId: number | null = null;
      if (content) {
        const message = await addMessage.mutateAsync({
          id: ticketId,
          data: { content, isInternal: isStaff ? internalNote : false },
        });
        messageId = message.id;
      }
      const queue = [...pending];
      for (const att of queue) {
        await addAttachment.mutateAsync({
          id: ticketId,
          data: {
            filename: att.filename,
            contentType: att.contentType,
            data: att.data,
            messageId,
          },
        });
        setPending((prev) => prev.filter((p) => p.key !== att.key));
      }
      setReply('');
      setInternalNote(false);
      setPending([]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      invalidate();
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 350);
    } catch {
      setComposerError("Couldn't send. Check your connection and try again.");
      invalidate();
    } finally {
      setSending(false);
    }
  };

  const onOpenAttachment = async (att: TicketAttachment) => {
    if (downloadingId !== null) return;
    setDownloadingId(att.id);
    setDownloadError(null);
    try {
      const content = await getAttachmentContent(att.id);
      await openAttachmentContent(content);
    } catch (err) {
      setDownloadError(
        err instanceof Error && err.message
          ? err.message
          : "Couldn't download that attachment. Try again.",
      );
    } finally {
      setDownloadingId(null);
    }
  };

  const header = ticket ? (
    <View style={styles.headerContent}>
      <View style={styles.badgeRow}>
        <SeverityBadge severity={ticket.severity} />
        <StatusBadge status={ticket.status} />
      </View>
      <Text style={[styles.ticketTitle, { color: colors.foreground }]}>{ticket.title}</Text>
      <Text style={[styles.ticketMeta, { color: colors.mutedForeground }]}>
        #{ticket.id} · {ticket.orgName} · Raised by {ticket.raisedByName} ·{' '}
        {formatDateTime(ticket.createdAt)}
      </Text>

      {slaState ? (
        <View
          style={[
            styles.slaBanner,
            { backgroundColor: slaState.bg, borderColor: slaState.border, borderRadius: colors.radius },
          ]}
        >
          <Feather name={slaState.icon} size={14} color={slaState.fg} />
          <Text style={[styles.slaText, { color: slaState.fg }]}>{slaState.label}</Text>
          {ticket.sla.resolutionDeadline ? (
            <Text style={[styles.slaDeadline, { color: slaState.fg }]}>
              Resolve by {formatDateTime(ticket.sla.resolutionDeadline)}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View
        style={[
          styles.descriptionCard,
          { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius + 4 },
        ]}
      >
        <Text style={[styles.descriptionLabel, { color: colors.mutedForeground }]}>Description</Text>
        <Text style={[styles.descriptionText, { color: colors.cardForeground }]}>
          {ticket.description}
        </Text>
      </View>

      {attachments.length > 0 ? (
        <View style={styles.attachmentsSection}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
            Attachments ({attachments.length})
          </Text>
          {attachments.map((att) => (
            <AttachmentRow
              key={att.id}
              attachment={att}
              downloading={downloadingId === att.id}
              onPress={() => onOpenAttachment(att)}
            />
          ))}
          {downloadError ? (
            <Text style={styles.attachmentErrorText}>{downloadError}</Text>
          ) : null}
        </View>
      ) : null}

      <View style={styles.assigneeRow}>
        <Feather
          name="user"
          size={14}
          color={ticket.assignedToName ? colors.mutedForeground : '#B45309'}
        />
        <Text
          style={[
            styles.assigneeText,
            { color: ticket.assignedToName ? colors.mutedForeground : '#B45309' },
          ]}
        >
          {ticket.assignedToName ? `Assigned to ${ticket.assignedToName}` : 'Unassigned'}
        </Text>
        {isStaff && me.data && ticket.assignedToId !== me.data.id ? (
          <Pressable
            testID="assign-to-me-button"
            onPress={() => assign.mutate({ id: ticketId, data: { assignedToId: me.data!.id } })}
            disabled={assign.isPending}
            style={({ pressed }) => [
              styles.assignButton,
              { borderColor: colors.accent, borderRadius: 999, opacity: pressed || assign.isPending ? 0.6 : 1 },
            ]}
          >
            <Text style={[styles.assignButtonText, { color: colors.accent }]}>Assign to me</Text>
          </Pressable>
        ) : null}
      </View>

      {isStaff ? (
        <View style={styles.statusSection}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Set status</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statusChips}>
            {STATUS_ORDER.map((status) => {
              const meta = STATUS_META[status];
              const active = ticket.status === status;
              return (
                <Pressable
                  key={status}
                  testID={`set-status-${status}`}
                  disabled={active || changeStatus.isPending}
                  onPress={() => changeStatus.mutate({ id: ticketId, data: { status } })}
                  style={[
                    styles.statusChip,
                    {
                      backgroundColor: active ? meta.bg : colors.background,
                      borderColor: active ? meta.border : colors.border,
                      opacity: changeStatus.isPending && !active ? 0.5 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.statusChipText,
                      { color: active ? meta.fg : colors.mutedForeground },
                    ]}
                  >
                    {meta.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 18 }]}>
        Conversation
      </Text>
    </View>
  ) : null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.navBar, { paddingTop: insets.top + 8, borderBottomColor: colors.border }]}>
        <Pressable testID="back-button" onPress={() => router.back()} hitSlop={10} style={styles.backButton}>
          <Feather name="chevron-left" size={24} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.navTitle, { color: colors.foreground }]} numberOfLines={1}>
          Ticket #{Number.isNaN(ticketId) ? '' : ticketId}
        </Text>
        <View style={styles.backButton} />
      </View>

      {detail.isLoading || me.isLoading ? (
        <LoadingView />
      ) : detail.isError || !ticket ? (
        <ErrorView message="Couldn't load this ticket." onRetry={() => detail.refetch()} />
      ) : (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(item) => String(item.id)}
            ListHeaderComponent={header}
            renderItem={({ item }) => <MessageBubble message={item} isStaffViewer={isStaff} />}
            contentContainerStyle={styles.listContent}
            ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
            ListEmptyComponent={
              <Text style={[styles.noMessages, { color: colors.mutedForeground }]}>
                No replies yet.
              </Text>
            }
          />

          <View
            style={[
              styles.composer,
              {
                borderTopColor: colors.border,
                backgroundColor: internalNote ? '#FFFBEB' : colors.background,
                paddingBottom: insets.bottom + 10,
              },
            ]}
          >
            {pending.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.pendingChips}
              >
                {pending.map((att) => (
                  <View
                    key={att.key}
                    style={[
                      styles.pendingChip,
                      { backgroundColor: colors.muted, borderColor: colors.border },
                    ]}
                  >
                    <Feather
                      name={attachmentIcon(att.contentType)}
                      size={12}
                      color={colors.mutedForeground}
                    />
                    <Text
                      style={[styles.pendingChipText, { color: colors.foreground }]}
                      numberOfLines={1}
                    >
                      {att.filename}
                    </Text>
                    <Text style={[styles.pendingChipSize, { color: colors.mutedForeground }]}>
                      {formatBytes(att.sizeBytes)}
                    </Text>
                    <Pressable
                      testID={`remove-pending-${att.key}`}
                      hitSlop={8}
                      disabled={sending}
                      onPress={() => setPending((prev) => prev.filter((p) => p.key !== att.key))}
                    >
                      <Feather name="x" size={13} color={colors.mutedForeground} />
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            ) : null}
            {composerError ? (
              <Text style={styles.attachmentErrorText}>{composerError}</Text>
            ) : null}
            {isStaff ? (
              <View style={styles.internalRow}>
                <Feather name="eye-off" size={13} color={internalNote ? '#B45309' : colors.mutedForeground} />
                <Text
                  style={[
                    styles.internalLabel,
                    { color: internalNote ? '#B45309' : colors.mutedForeground },
                  ]}
                >
                  Internal note (hidden from customer)
                </Text>
                <Switch
                  testID="internal-note-switch"
                  value={internalNote}
                  onValueChange={setInternalNote}
                  trackColor={{ true: '#F59E0B' }}
                />
              </View>
            ) : null}
            <View style={styles.composerRow}>
              <Pressable
                testID="attach-photo-button"
                onPress={() => onPick('photo')}
                disabled={picking || sending}
                hitSlop={6}
                style={({ pressed }) => [
                  styles.attachButton,
                  { opacity: picking || sending || pressed ? 0.5 : 1 },
                ]}
              >
                <Feather name="image" size={20} color={colors.mutedForeground} />
              </Pressable>
              <Pressable
                testID="attach-file-button"
                onPress={() => onPick('file')}
                disabled={picking || sending}
                hitSlop={6}
                style={({ pressed }) => [
                  styles.attachButton,
                  { opacity: picking || sending || pressed ? 0.5 : 1 },
                ]}
              >
                <Feather name="paperclip" size={19} color={colors.mutedForeground} />
              </Pressable>
              <TextInput
                testID="reply-input"
                style={[
                  styles.replyInput,
                  {
                    borderColor: colors.input,
                    borderRadius: colors.radius + 10,
                    color: colors.foreground,
                    backgroundColor: colors.background,
                  },
                ]}
                placeholder={internalNote ? 'Add an internal note…' : 'Write a reply…'}
                placeholderTextColor={colors.mutedForeground}
                value={reply}
                onChangeText={setReply}
                multiline
              />
              <Pressable
                testID="send-button"
                onPress={onSend}
                disabled={(!reply.trim() && pending.length === 0) || sending}
                style={({ pressed }) => [
                  styles.sendButton,
                  {
                    backgroundColor: internalNote ? '#B45309' : colors.accent,
                    opacity:
                      (!reply.trim() && pending.length === 0) || sending || pressed ? 0.6 : 1,
                  },
                ]}
              >
                {sending ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Feather name="send" size={17} color="#FFFFFF" />
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: {
    width: 40,
    alignItems: 'flex-start',
  },
  navTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
  headerContent: {
    paddingTop: 16,
    gap: 10,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 6,
  },
  ticketTitle: {
    fontSize: 19,
    fontFamily: 'Inter_700Bold',
    lineHeight: 26,
  },
  ticketMeta: {
    fontSize: 12.5,
    fontFamily: 'Inter_400Regular',
    lineHeight: 18,
  },
  slaBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexWrap: 'wrap',
  },
  slaText: {
    fontSize: 12.5,
    fontFamily: 'Inter_600SemiBold',
  },
  slaDeadline: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  descriptionCard: {
    borderWidth: 1,
    padding: 12,
    gap: 4,
  },
  descriptionLabel: {
    fontSize: 11.5,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  descriptionText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    lineHeight: 20,
  },
  assigneeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  assigneeText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    flex: 1,
  },
  assignButton: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  assignButtonText: {
    fontSize: 12.5,
    fontFamily: 'Inter_600SemiBold',
  },
  statusSection: {
    gap: 6,
    marginTop: 4,
  },
  attachmentsSection: {
    gap: 6,
    marginTop: 4,
  },
  attachmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  attachmentIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentInfo: {
    flex: 1,
    gap: 1,
  },
  attachmentName: {
    fontSize: 13.5,
    fontFamily: 'Inter_500Medium',
  },
  attachmentMeta: {
    fontSize: 11.5,
    fontFamily: 'Inter_400Regular',
  },
  attachmentErrorText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: '#B91C1C',
  },
  pendingChips: {
    gap: 6,
    paddingBottom: 8,
    paddingRight: 16,
  },
  pendingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    maxWidth: 220,
  },
  pendingChipText: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    flexShrink: 1,
  },
  pendingChipSize: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
  },
  attachButton: {
    paddingBottom: 10,
    paddingHorizontal: 2,
  },
  sectionLabel: {
    fontSize: 11.5,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  statusChips: {
    gap: 6,
    paddingRight: 16,
  },
  statusChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  statusChipText: {
    fontSize: 12.5,
    fontFamily: 'Inter_500Medium',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  noMessages: {
    fontSize: 13.5,
    fontFamily: 'Inter_400Regular',
    marginTop: 8,
  },
  messageRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 2,
  },
  messageAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  messageAvatarText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },
  messageBubble: {
    flex: 1,
    borderWidth: 1,
    padding: 10,
    gap: 4,
  },
  messageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  messageAuthor: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    flexShrink: 1,
  },
  internalTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#FEF3C7',
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  internalTagText: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    color: '#B45309',
  },
  messageTime: {
    fontSize: 11.5,
    fontFamily: 'Inter_400Regular',
    marginLeft: 'auto',
  },
  messageContent: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    lineHeight: 20,
  },
  composer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingTop: 8,
    gap: 6,
  },
  internalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  internalLabel: {
    flex: 1,
    fontSize: 12.5,
    fontFamily: 'Inter_500Medium',
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  replyInput: {
    flex: 1,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 14.5,
    fontFamily: 'Inter_400Regular',
    maxHeight: 110,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
