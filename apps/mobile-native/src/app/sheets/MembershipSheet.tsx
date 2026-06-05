// @ts-nocheck
/**
 * MembershipSheet — team-scoped identity. Claim your identity on this team
 * (username + password → Argon2id → self-signed roster claim → presence), see
 * your current membership, and leave the team. Mirrors the desktop claim-or-login.
 */
import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Sheet, PrimaryButton, GhostButton, SectionLabel } from '../../ui/components';
import { useThemeColors, MONO, FONT, radius } from '../../ui/theme';
import { getTeam, removeTeam } from '../../store/teams';
import { getIdentity, setIdentity, clearIdentity } from '../../store/settings';
import { getSession, dropSession } from '../../store/sessions';
import { claimIdentity } from '../../engine/identity';

export default function MembershipSheet({ visible, teamId, onClose, onLeft }) {
  const c = useThemeColors();
  const team = teamId ? getTeam(teamId) : null;
  const identity = teamId ? getIdentity(teamId) : null;
  const [username, setUsername] = useState(identity?.username || '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const claim = async () => {
    setError(null);
    const uname = username.trim();
    if (!uname || !password) {
      setError('Username and password are required.');
      return;
    }
    setBusy(true);
    try {
      const session = getSession(teamId);
      const root = session && session.getRootDoc();
      if (!root) {
        setError('Not connected to the team yet — wait for the relay to connect, then retry.');
        return;
      }
      const id = await claimIdentity(root, session.material, { username: uname, password });
      await setIdentity(teamId, id);
      session.setPresence({ name: id.username, color: id.color });
      setPassword('');
      Alert.alert('Joined', `You are "${id.username}" on this team.`);
      onClose();
    } catch (e) {
      setError(e?.message ? String(e.message) : String(e));
    } finally {
      setBusy(false);
    }
  };

  const leave = () => {
    Alert.alert('Leave team?', `Remove "${team?.teamName || 'this team'}" and its local copy from this phone?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {
          dropSession(teamId);
          await clearIdentity(teamId);
          await removeTeam(teamId);
          onLeft(teamId);
        },
      },
    ]);
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={team?.teamName || 'Membership'}>
      <ScrollView contentContainerStyle={ms.scroll} keyboardShouldPersistTaps="handled">
        <SectionLabel>{identity ? 'Your membership' : 'Join this team'}</SectionLabel>
        {identity ? (
          <View style={[ms.idCard, { backgroundColor: c.surface, borderColor: c.border }]}>
            <View style={[ms.swatch, { backgroundColor: identity.color }]}>
              <Text style={ms.swatchText}>{(identity.username || '?').charAt(0).toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[ms.idName, { color: c.textHi }]}>{identity.username}</Text>
              <Text style={[ms.idKey, { color: c.faint }]} numberOfLines={1}>
                {identity.publicKey.slice(0, 24)}…
              </Text>
            </View>
          </View>
        ) : (
          <Text style={[ms.hint, { color: c.faint }]}>
            Pick the same username + password you use on the desktop for this team. Your identity is
            derived locally (Argon2id) and self-signed into the roster — nothing is sent to a server.
          </Text>
        )}

        <Text style={[ms.label, { color: c.muted }]}>Username</Text>
        <TextInput
          style={[ms.input, { backgroundColor: c.surface, borderColor: c.border, color: c.text }]}
          value={username}
          onChangeText={setUsername}
          placeholder="e.g. ashiq"
          placeholderTextColor={c.faint}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy}
        />
        <Text style={[ms.label, { color: c.muted }]}>Password</Text>
        <TextInput
          style={[ms.input, { backgroundColor: c.surface, borderColor: c.border, color: c.text }]}
          value={password}
          onChangeText={setPassword}
          placeholder={identity ? 're-enter to re-claim' : 'team password'}
          placeholderTextColor={c.faint}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          editable={!busy}
        />

        {error ? (
          <View style={[ms.errBox, { backgroundColor: c.accentSoft }]}>
            <Text style={[ms.errText, { color: c.danger }]}>{error}</Text>
          </View>
        ) : null}

        <View style={{ height: 14 }} />
        <PrimaryButton
          title={identity ? 'Re-claim identity' : 'Join team'}
          onPress={claim}
          loading={busy}
          disabled={!username.trim() || !password}
        />
        {busy ? <Text style={[ms.busyHint, { color: c.faint }]}>Deriving identity (Argon2id)… this takes a second.</Text> : null}

        <View style={{ height: 30 }} />
        <GhostButton title="Leave team" color={c.danger} icon="exit-outline" onPress={leave} />
      </ScrollView>
    </Sheet>
  );
}

const ms = StyleSheet.create({
  scroll: { padding: 16, paddingBottom: 60 },
  label: { fontSize: 12, fontWeight: '600', marginTop: 14, marginBottom: 6, fontFamily: FONT },
  input: { borderRadius: radius.md, padding: 12, fontSize: 15, borderWidth: StyleSheet.hairlineWidth, fontFamily: FONT },
  hint: { fontSize: 12, marginTop: 4, marginBottom: 4, lineHeight: 18, fontFamily: FONT },
  idCard: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.md, padding: 14, gap: 12, borderWidth: StyleSheet.hairlineWidth },
  swatch: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  swatchText: { color: '#fff', fontSize: 15, fontWeight: '700', fontFamily: FONT },
  idName: { fontSize: 16, fontWeight: '700', fontFamily: FONT },
  idKey: { fontSize: 11, fontFamily: MONO, marginTop: 2 },
  errBox: { borderRadius: radius.sm, padding: 12, marginTop: 14 },
  errText: { fontSize: 13, lineHeight: 19, fontFamily: FONT },
  busyHint: { fontSize: 12, textAlign: 'center', marginTop: 10, fontFamily: FONT },
});
