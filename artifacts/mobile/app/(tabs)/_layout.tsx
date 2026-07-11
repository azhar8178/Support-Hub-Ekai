import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';
import { useAuth, useClerk } from '@clerk/expo';
import { setAuthTokenGetter, useGetCurrentUser } from '@workspace/api-client-react';
import { LoadingView, ErrorView } from '@/components/StateViews';
import { useColors } from '@/hooks/useColors';

function NotInvitedScreen() {
  const colors = useColors();
  const { signOut } = useClerk();
  return (
    <View style={[styles.center, { backgroundColor: colors.background }]}>
      <View style={[styles.iconCircle, { backgroundColor: colors.muted }]}>
        <Feather name="lock" size={28} color={colors.mutedForeground} />
      </View>
      <Text style={[styles.title, { color: colors.foreground }]}>No portal access</Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        Your account isn't linked to the Ekai Support Portal yet. Ask your Ekai admin to send you
        an invite, then sign in again.
      </Text>
      <Pressable
        testID="sign-out-button"
        onPress={() => signOut()}
        style={({ pressed }) => [
          styles.signOut,
          { borderColor: colors.border, borderRadius: colors.radius, opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <Text style={[styles.signOutText, { color: colors.foreground }]}>Sign out</Text>
      </Pressable>
    </View>
  );
}

function PortalTabs() {
  const colors = useColors();
  const me = useGetCurrentUser();

  if (me.isLoading) {
    return <LoadingView />;
  }

  if (me.isError) {
    const status = (me.error as { status?: number } | null)?.status;
    if (status === 403) {
      return <NotInvitedScreen />;
    }
    return <ErrorView message="Couldn't load your profile." onRetry={() => me.refetch()} />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          ...(Platform.OS === 'web' ? { height: 84, paddingTop: 8 } : {}),
        },
        tabBarLabelStyle: {
          fontFamily: 'Inter_500Medium',
          fontSize: 11,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Tickets',
          tabBarIcon: ({ color, size }) => <Feather name="inbox" size={size - 2} color={color} />,
        }}
      />
      <Tabs.Screen
        name="help"
        options={{
          title: 'Help',
          tabBarIcon: ({ color, size }) => (
            <Feather name="book-open" size={size - 2} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: 'Notifications',
          tabBarIcon: ({ color, size }) => <Feather name="bell" size={size - 2} color={color} />,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'Account',
          tabBarIcon: ({ color, size }) => <Feather name="user" size={size - 2} color={color} />,
        }}
      />
    </Tabs>
  );
}

export default function TabLayout() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [tokenReady, setTokenReady] = useState(false);

  useEffect(() => {
    setAuthTokenGetter(() => getToken());
    setTokenReady(true);
  }, [getToken]);

  if (!isLoaded) {
    return <LoadingView />;
  }

  if (!isSignedIn) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  if (!tokenReady) {
    return <LoadingView />;
  }

  return <PortalTabs />;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 10,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  title: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 21,
  },
  signOut: {
    marginTop: 14,
    borderWidth: 1,
    paddingHorizontal: 24,
    paddingVertical: 11,
  },
  signOutText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
});
