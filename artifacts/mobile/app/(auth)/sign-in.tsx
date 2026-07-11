import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Redirect, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import { useAuth, useSignIn, useSSO } from '@clerk/expo';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useColors } from '@/hooks/useColors';
import { useScreenInsets } from '@/hooks/useWebInsets';

// Preloads the browser on Android to reduce OAuth load time
function useWarmUpBrowser() {
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    void WebBrowser.warmUpAsync();
    return () => {
      void WebBrowser.coolDownAsync();
    };
  }, []);
}

WebBrowser.maybeCompleteAuthSession();

function readableError(error: unknown): string {
  const anyErr = error as { errors?: { longMessage?: string; message?: string }[]; message?: string };
  return (
    anyErr?.errors?.[0]?.longMessage ??
    anyErr?.errors?.[0]?.message ??
    anyErr?.message ??
    'Sign in failed. Please try again.'
  );
}

export default function SignInScreen() {
  useWarmUpBrowser();
  const colors = useColors();
  const insets = useScreenInsets();
  const router = useRouter();
  const { isSignedIn } = useAuth();
  const { signIn, fetchStatus } = useSignIn();
  const { startSSOFlow } = useSSO();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [ssoLoading, setSsoLoading] = useState(false);

  const loading = fetchStatus === 'fetching' || ssoLoading;

  const onPasswordSignIn = useCallback(async () => {
    if (!signIn || loading) return;
    setFormError(null);
    try {
      const { error } = await signIn.password({
        emailAddress: email.trim(),
        password,
      });
      if (error) {
        setFormError(readableError(error));
        return;
      }
      if (signIn.status === 'complete') {
        await signIn.finalize({
          navigate: async () => {
            router.replace('/(tabs)');
          },
        });
      } else {
        setFormError('Additional verification is required. Please sign in on the web portal first.');
      }
    } catch (err) {
      setFormError(readableError(err));
    }
  }, [signIn, email, password, loading, router]);

  const onGoogleSignIn = useCallback(async () => {
    if (loading) return;
    setFormError(null);
    setSsoLoading(true);
    try {
      const { createdSessionId, setActive } = await startSSOFlow({
        strategy: 'oauth_google',
        redirectUrl: AuthSession.makeRedirectUri(),
      });
      if (createdSessionId && setActive) {
        await setActive({
          session: createdSessionId,
          navigate: async () => {
            router.replace('/(tabs)');
          },
        });
      }
    } catch (err) {
      setFormError(readableError(err));
    } finally {
      setSsoLoading(false);
    }
  }, [startSSOFlow, loading, router]);

  if (isSignedIn) {
    return <Redirect href="/(tabs)" />;
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.logoBox, { backgroundColor: '#0F1F3D', borderRadius: 18 }]}>
          <Feather name="headphones" size={30} color="#FFFFFF" />
        </View>
        <Text style={[styles.title, { color: colors.foreground }]}>Ekai Support</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Sign in to manage your support tickets
        </Text>

        {formError ? (
          <View style={[styles.errorBox, { borderRadius: colors.radius }]}>
            <Feather name="alert-circle" size={16} color="#B91C1C" />
            <Text style={styles.errorText}>{formError}</Text>
          </View>
        ) : null}

        <View style={styles.form}>
          <Text style={[styles.label, { color: colors.foreground }]}>Email</Text>
          <TextInput
            testID="email-input"
            style={[
              styles.input,
              {
                borderColor: colors.input,
                borderRadius: colors.radius,
                color: colors.foreground,
                backgroundColor: colors.background,
              },
            ]}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            placeholder="you@company.com"
            placeholderTextColor={colors.mutedForeground}
            value={email}
            onChangeText={setEmail}
          />

          <Text style={[styles.label, { color: colors.foreground }]}>Password</Text>
          <TextInput
            testID="password-input"
            style={[
              styles.input,
              {
                borderColor: colors.input,
                borderRadius: colors.radius,
                color: colors.foreground,
                backgroundColor: colors.background,
              },
            ]}
            secureTextEntry
            autoComplete="current-password"
            placeholder="Your password"
            placeholderTextColor={colors.mutedForeground}
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={onPasswordSignIn}
          />

          <Pressable
            testID="sign-in-button"
            onPress={onPasswordSignIn}
            disabled={loading || !email || !password}
            style={({ pressed }) => [
              styles.primaryButton,
              {
                backgroundColor: '#0F1F3D',
                borderRadius: colors.radius,
                opacity: pressed || loading || !email || !password ? 0.75 : 1,
              },
            ]}
          >
            {fetchStatus === 'fetching' ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryButtonText}>Sign in</Text>
            )}
          </Pressable>

          <View style={styles.dividerRow}>
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <Text style={[styles.dividerText, { color: colors.mutedForeground }]}>or</Text>
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
          </View>

          <Pressable
            testID="google-sign-in-button"
            onPress={onGoogleSignIn}
            disabled={loading}
            style={({ pressed }) => [
              styles.secondaryButton,
              {
                borderColor: colors.border,
                borderRadius: colors.radius,
                backgroundColor: colors.background,
                opacity: pressed || loading ? 0.75 : 1,
              },
            ]}
          >
            {ssoLoading ? (
              <ActivityIndicator size="small" color={colors.foreground} />
            ) : (
              <>
                <Feather name="chrome" size={17} color={colors.foreground} />
                <Text style={[styles.secondaryButtonText, { color: colors.foreground }]}>
                  Continue with Google
                </Text>
              </>
            )}
          </Pressable>
        </View>

        <View style={[styles.inviteNote, { backgroundColor: colors.muted, borderRadius: colors.radius }]}>
          <Feather name="info" size={14} color={colors.mutedForeground} />
          <Text style={[styles.inviteNoteText, { color: colors.mutedForeground }]}>
            Access is by invitation. If you don't have an account yet, ask your Ekai admin for an
            invite.
          </Text>
        </View>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 24,
    alignItems: 'stretch',
  },
  logoBox: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 26,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 28,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FECACA',
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    flex: 1,
    color: '#B91C1C',
    fontSize: 13.5,
    fontFamily: 'Inter_500Medium',
    lineHeight: 19,
  },
  form: {
    gap: 8,
  },
  label: {
    fontSize: 13.5,
    fontFamily: 'Inter_600SemiBold',
    marginTop: 6,
  },
  input: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
  },
  primaryButton: {
    marginTop: 16,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginVertical: 14,
  },
  divider: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  dividerText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    paddingVertical: 13,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
  },
  inviteNote: {
    flexDirection: 'row',
    gap: 8,
    padding: 12,
    marginTop: 28,
    alignItems: 'flex-start',
  },
  inviteNoteText: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    lineHeight: 18,
  },
});
