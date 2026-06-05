// @ts-nocheck
/**
 * WorkspaceSwitcher — the teams list, opened from the sidebar workspace header.
 * Tap a team to switch the active workspace; "Add a team" opens the join sheet.
 * Each row shows the team avatar, name, page count, and a live-connection dot.
 */
import React, { useEffect, useReducer } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Sheet } from '../ui/components';
import { useThemeColors, radius, FONT } from '../ui/theme';
import { getTeams, onTeamsChange } from '../store/teams';
import { peekSession } from '../store/sessions';

function TeamRow({ team, active, onPress, c }) {
  const session = peekSession(team.teamId);
  const online = session ? session.online : false;
  const pages = session ? session.tree.length : 0;
  const initial = (team.teamName || 'T').trim().charAt(0).toUpperCase() || 'T';
  return (
    <Pressable onPress={() => onPress(team)} style={({ pressed }) => [ws.row, pressed && { backgroundColor: c.hover }]}>
      <View style={[ws.avatar, { backgroundColor: active ? c.accent : c.surfaceAlt }]}>
        <Text style={[ws.avatarText, { color: active ? '#fff' : c.muted }]}>{initial}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={[ws.name, { color: c.text }]}>
          {team.teamName || 'Untitled team'}
        </Text>
        <Text numberOfLines={1} style={[ws.sub, { color: c.faint }]}>
          {pages > 0 ? `${pages} page${pages === 1 ? '' : 's'}` : 'No pages yet'}
          {online ? ' · online' : ''}
        </Text>
      </View>
      {online ? <View style={[ws.dot, { backgroundColor: c.green }]} /> : null}
      {active ? <Ionicons name="checkmark" size={18} color={c.accent} style={{ marginLeft: 8 }} /> : null}
    </Pressable>
  );
}

export default function WorkspaceSwitcher({ visible, activeTeamId, onClose, onSelect, onAddTeam }) {
  const c = useThemeColors();
  const [, force] = useReducer((n) => n + 1, 0);
  useEffect(() => onTeamsChange(force), []);
  const teams = getTeams();

  return (
    <Sheet visible={visible} onClose={onClose} title="Switch workspace">
      <ScrollView contentContainerStyle={{ paddingVertical: 8 }}>
        {teams.length === 0 ? (
          <Text style={[ws.empty, { color: c.faint }]}>No teams yet. Add one to begin.</Text>
        ) : (
          teams.map((t) => (
            <TeamRow key={t.teamId} team={t} active={t.teamId === activeTeamId} onPress={onSelect} c={c} />
          ))
        )}

        <Pressable onPress={onAddTeam} style={({ pressed }) => [ws.row, { marginTop: 4 }, pressed && { backgroundColor: c.hover }]}>
          <View style={[ws.avatar, { backgroundColor: c.surfaceAlt }]}>
            <Ionicons name="add" size={22} color={c.muted} />
          </View>
          <Text style={[ws.name, { color: c.accent }]}>Add a team</Text>
        </Pressable>
      </ScrollView>
    </Sheet>
  );
}

const ws = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 11, gap: 12 },
  avatar: { width: 38, height: 38, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 16, fontWeight: '700', fontFamily: FONT },
  name: { fontSize: 16, fontWeight: '600', fontFamily: FONT },
  sub: { fontSize: 12, marginTop: 2, fontFamily: FONT },
  dot: { width: 8, height: 8, borderRadius: 4 },
  empty: { textAlign: 'center', padding: 30, fontSize: 14, fontFamily: FONT },
});
