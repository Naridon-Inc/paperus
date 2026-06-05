// @ts-nocheck
/**
 * App.tsx — Notionless mobile (native) root.
 *
 * Boots the persisted stores (settings + teams) and the icon font, then mounts
 * the Notion-style AppShell (sidebar + page editor + modal sheets). Deep links,
 * active-team/page state, and the secondary flows all live inside AppShell.
 *
 * Engine wiring (P2P + E2EE + persistence) lives in src/engine + src/store; this
 * file is only boot. WebRTC/Node globals are installed by index.ts →
 * src/shims/globals before anything here evaluates.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Font from 'expo-font';
import { Ionicons } from '@expo/vector-icons';

import AppShell from './src/app/AppShell';
import { Spinner } from './src/ui/components';
import { useThemeColors, FONT } from './src/ui/theme';
import { loadSettings } from './src/store/settings';
import { loadTeams } from './src/store/teams';

export default function App() {
  const c = useThemeColors();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        // Preload the icon glyph font so icons never flash as tofu (this build's
        // Text fallback chain excludes Apple Color Emoji, so we use a real TTF set).
        await Font.loadAsync(Ionicons.font);
      } catch (_e) {
        /* icons will still load lazily */
      }
      try {
        await loadSettings();
        await loadTeams();
      } catch (_e) {
        /* boot best-effort */
      } finally {
        setReady(true);
      }
    })();
  }, []);

  if (!ready) {
    return (
      <View style={[styles.boot, { backgroundColor: c.bg }]}>
        <StatusBar style={c.mode === 'dark' ? 'light' : 'dark'} />
        <Text style={[styles.logo, { color: c.textHi }]}>Notionless</Text>
        <Spinner label="Loading…" />
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <AppShell />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  boot: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  logo: { fontSize: 26, fontWeight: '800', marginBottom: 20, fontFamily: FONT },
});
