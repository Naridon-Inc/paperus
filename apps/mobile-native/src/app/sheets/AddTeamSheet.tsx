// @ts-nocheck
/**
 * AddTeamSheet — paste or scan a team / pairing link, verify + derive the team
 * material, persist it, and hand the new teamId back to the shell. QR scanning is
 * an in-sheet camera mode (expo-camera) rather than a separate screen.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { Sheet, PrimaryButton } from '../../ui/components';
import { useThemeColors, MONO, FONT, radius } from '../../ui/theme';
import { parsePairingLink, verifyPairingPayload, deriveCompanionTeamMaterial } from '../../engine/device-link';
import { addTeam } from '../../store/teams';

export default function AddTeamSheet({ visible, initialLink, onClose, onJoined }) {
  const c = useThemeColors();
  const [link, setLink] = useState(initialLink || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const locked = useRef(false);

  useEffect(() => {
    if (visible) {
      setLink(initialLink || '');
      setError(null);
      setScanning(false);
      locked.current = false;
    }
  }, [visible, initialLink]);

  const submit = async (raw0) => {
    const raw = (typeof raw0 === 'string' ? raw0 : link).trim();
    if (!raw) return;
    setError(null);
    setBusy(true);
    try {
      const payload = parsePairingLink(raw);
      if (!payload) {
        setError('Unrecognized link. Paste a notionless-team: or notionless-pair: link from the desktop.');
        return;
      }
      const v = await verifyPairingPayload(payload);
      if (!v.ok) {
        setError(
          v.reason === 'expired'
            ? 'This pairing link expired — generate a fresh one on the desktop.'
            : v.reason === 'team-id-mismatch'
              ? 'Link is inconsistent (team id mismatch).'
              : 'Link is invalid.',
        );
        return;
      }
      const mat = await deriveCompanionTeamMaterial(payload);
      if (!mat) {
        setError('Could not derive team keys from the link.');
        return;
      }
      const stored = await addTeam({ ...mat, teamName: payload.teamName || mat.teamName || null });
      onJoined(stored.teamId);
    } catch (e) {
      setError(e?.message ? String(e.message) : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onScan = (result) => {
    if (locked.current) return;
    const data = result?.data;
    if (!data) return;
    locked.current = true;
    setScanning(false);
    setLink(String(data));
    submit(String(data));
  };

  const startScan = async () => {
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res?.granted) {
        setError('Camera access is needed to scan the team QR code.');
        return;
      }
    }
    locked.current = false;
    setScanning(true);
  };

  const headerAction = !scanning ? (
    <TouchableOpacity onPress={() => submit()} disabled={busy || !link.trim()} hitSlop={8}>
      <Text style={[ats.join, { color: busy || !link.trim() ? c.faint : c.accent }]}>Join</Text>
    </TouchableOpacity>
  ) : null;

  return (
    <Sheet visible={visible} onClose={onClose} title={scanning ? 'Scan QR code' : 'Add a team'} headerAction={headerAction}>
      {scanning ? (
        <View style={{ flex: 1 }}>
          <View style={ats.cameraWrap}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={onScan}
            />
            <View style={[ats.reticle, { borderColor: 'rgba(255,255,255,0.85)' }]} pointerEvents="none" />
          </View>
          <Text style={[ats.hint, { color: c.muted, textAlign: 'center' }]}>Point the camera at the team QR code</Text>
          <TouchableOpacity style={ats.linkBtn} onPress={() => setScanning(false)}>
            <Text style={[ats.linkBtnText, { color: c.accent }]}>Enter link manually instead</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={ats.scroll} keyboardShouldPersistTaps="handled">
          <Text style={[ats.label, { color: c.muted }]}>Team or pairing link</Text>
          <TextInput
            style={[ats.input, { backgroundColor: c.surface, borderColor: c.border, color: c.text }]}
            value={link}
            onChangeText={setLink}
            placeholder="notionless-team:…  or  notionless-pair:v1.…"
            placeholderTextColor={c.faint}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            editable={!busy}
          />

          <TouchableOpacity style={[ats.scan, { backgroundColor: c.surface, borderColor: c.border }]} onPress={startScan} disabled={busy}>
            <Ionicons name="qr-code-outline" size={18} color={c.text} />
            <Text style={[ats.scanText, { color: c.text }]}>Scan QR code instead</Text>
          </TouchableOpacity>

          {error ? (
            <View style={[ats.errBox, { backgroundColor: c.accentSoft }]}>
              <Text style={[ats.errText, { color: c.danger }]}>{error}</Text>
            </View>
          ) : null}

          <View style={{ height: 18 }} />
          <PrimaryButton title="Join team" onPress={() => submit()} loading={busy} disabled={!link.trim()} />

          <Text style={[ats.note, { color: c.faint }]}>
            On the desktop: open a team → Share → copy the team link, or generate a phone pairing
            link. The link carries the team's keys; nothing is sent to a server.
          </Text>
        </ScrollView>
      )}
    </Sheet>
  );
}

const ats = StyleSheet.create({
  scroll: { padding: 18, paddingBottom: 60 },
  join: { fontSize: 16, fontWeight: '700', fontFamily: FONT },
  label: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginBottom: 8, letterSpacing: 0.5, fontFamily: FONT },
  input: { borderRadius: radius.md, padding: 14, fontSize: 14, minHeight: 90, textAlignVertical: 'top', fontFamily: MONO, borderWidth: StyleSheet.hairlineWidth },
  scan: { marginTop: 14, padding: 14, borderRadius: radius.md, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, borderWidth: StyleSheet.hairlineWidth },
  scanText: { fontSize: 14, fontWeight: '600', fontFamily: FONT },
  errBox: { borderRadius: radius.sm, padding: 12, marginTop: 16 },
  errText: { fontSize: 13, lineHeight: 19, fontFamily: FONT },
  note: { fontSize: 12, marginTop: 22, lineHeight: 18, fontFamily: FONT },
  cameraWrap: { flex: 1, margin: 16, borderRadius: 16, overflow: 'hidden', backgroundColor: '#000' },
  reticle: { position: 'absolute', top: '25%', left: '15%', right: '15%', bottom: '25%', borderWidth: 2, borderRadius: 16 },
  hint: { fontSize: 14, paddingVertical: 12, fontFamily: FONT },
  linkBtn: { padding: 16, alignItems: 'center' },
  linkBtnText: { fontSize: 14, fontWeight: '600', fontFamily: FONT },
});
