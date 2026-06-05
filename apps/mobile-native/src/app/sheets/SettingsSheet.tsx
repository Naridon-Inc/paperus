// @ts-nocheck
/**
 * SettingsSheet — global, app-wide settings: the signaling relay list, an
 * on-device crypto self-test, the appearance note, and an About blurb. Team
 * membership lives in MembershipSheet, not here.
 */
import React, { useEffect, useReducer, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Sheet, PrimaryButton, SectionLabel } from '../../ui/components';
import { useThemeColors, MONO, FONT, radius } from '../../ui/theme';
import { getSignaling, setSignaling, onSettingsChange } from '../../store/settings';

export default function SettingsSheet({ visible, onClose }) {
  const c = useThemeColors();
  const [, force] = useReducer((n) => n + 1, 0);
  const [sig, setSig] = useState(getSignaling());
  const [diag, setDiag] = useState(null);

  useEffect(() => onSettingsChange(force), []);
  useEffect(() => {
    if (visible) setSig(getSignaling());
  }, [visible]);

  const save = async () => {
    await setSignaling(sig);
    Alert.alert('Saved', 'Signaling relays updated. Reopen a team to apply.');
  };

  const runSelfTest = async () => {
    setDiag({ running: true });
    try {
      const { runInterop } = await import('../../spike/interop');
      const r = await runInterop();
      setDiag({ running: false, pass: r.checks.filter((x) => x.pass).length, total: r.checks.length });
    } catch (e) {
      setDiag({ running: false, pass: 0, total: 0, error: e?.message || String(e) });
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Settings">
      <ScrollView contentContainerStyle={ss.scroll} keyboardShouldPersistTaps="handled">
        <SectionLabel>Signaling relays</SectionLabel>
        <TextInput
          style={[ss.input, { backgroundColor: c.surface, borderColor: c.border, color: c.text }]}
          value={sig}
          onChangeText={setSig}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
        />
        <Text style={[ss.hint, { color: c.faint }]}>
          Comma-separated. Simulator + desktop dev → ws://localhost:4444. Physical phone →
          wss://oss.naridon.com/signaling (or your Mac's ws://LAN-IP:4444).
        </Text>
        <View style={{ height: 12 }} />
        <PrimaryButton title="Save relays" onPress={save} />

        <SectionLabel>Diagnostics</SectionLabel>
        <TouchableOpacity style={[ss.rowBtn, { backgroundColor: c.surface, borderColor: c.border }]} onPress={runSelfTest}>
          <Text style={[ss.rowBtnText, { color: c.text }]}>
            {diag?.running
              ? 'Running crypto self-test…'
              : diag && diag.total
                ? `Crypto self-test: ${diag.pass}/${diag.total} vectors passed`
                : 'Run crypto self-test'}
          </Text>
        </TouchableOpacity>
        {diag?.error ? <Text style={[ss.hint, { color: c.danger }]}>{diag.error}</Text> : null}

        <SectionLabel>About</SectionLabel>
        <Text style={[ss.about, { color: c.muted }]}>
          Notionless — mobile companion. Local-first, zero-account, end-to-end encrypted P2P. This
          phone joins a desktop team over WebRTC; the relay only brokers connections and stores
          nothing. Appearance follows your system Light / Dark setting.
        </Text>
      </ScrollView>
    </Sheet>
  );
}

const ss = StyleSheet.create({
  scroll: { padding: 16, paddingBottom: 60 },
  input: { borderRadius: radius.md, padding: 12, fontSize: 13, fontFamily: MONO, minHeight: 70, textAlignVertical: 'top', borderWidth: StyleSheet.hairlineWidth },
  hint: { fontSize: 12, marginTop: 8, lineHeight: 18, fontFamily: FONT },
  rowBtn: { borderRadius: radius.md, padding: 14, alignItems: 'center', borderWidth: StyleSheet.hairlineWidth },
  rowBtnText: { fontSize: 14, fontWeight: '600', fontFamily: FONT },
  about: { fontSize: 13, lineHeight: 20, paddingHorizontal: 2 },
});
