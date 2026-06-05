// @ts-nocheck
/**
 * Sidebar.tsx — the slide-in left panel, Notion-style: a workspace switcher
 * header, search, the page tree (disclosure toggles + page icons + indentation),
 * a "New page" action, and a membership footer.
 *
 * The nested tree is recomputed from the live root doc each render (the parent
 * re-renders on session changes), so it stays in sync with desktop edits.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors, radius, FONT, TOP_INSET } from '../ui/theme';
import { readNotesTree, flattenTree } from '../engine/notes';
import { getDecoration } from '../store/decorations';

function PageRow({ node, depth, active, expanded, hasChildren, onToggle, onOpen, onLongPress, teamId, c }) {
  const deco = getDecoration(teamId, node.id);
  const iconName = deco.icon || (node.locked ? 'lock-closed' : 'document-text-outline');
  const iconColor = node.locked ? c.faint : deco.iconColor || c.muted;
  return (
    <Pressable
      onPress={() => onOpen(node)}
      onLongPress={() => onLongPress(node)}
      style={({ pressed }) => [
        srow.row,
        { paddingLeft: 8 + depth * 16 },
        active && { backgroundColor: c.hover },
        pressed && { backgroundColor: c.pressed },
      ]}
    >
      <TouchableOpacity
        onPress={() => (hasChildren ? onToggle(node.id) : onOpen(node))}
        hitSlop={8}
        style={srow.toggle}
      >
        {hasChildren ? (
          <Ionicons name={expanded ? 'chevron-down' : 'chevron-forward'} size={14} color={c.faint} />
        ) : (
          <View style={{ width: 14 }} />
        )}
      </TouchableOpacity>
      <Ionicons name={iconName} size={17} color={iconColor} style={{ marginRight: 8 }} />
      <Text numberOfLines={1} style={[srow.title, { color: node.locked ? c.faint : c.text }, node.locked && { fontStyle: 'italic' }]}>
        {node.title || 'Untitled'}
      </Text>
    </Pressable>
  );
}

export default function Sidebar({
  team,
  session,
  activeNoteId,
  online,
  identity,
  onSelectNote,
  onOpenSwitcher,
  onOpenSettings,
  onOpenMembership,
  onNewPage,
  onNoteActions,
}) {
  const c = useThemeColors();
  const [expanded, setExpanded] = useState(() => new Set());
  const [query, setQuery] = useState('');

  const root = session && session.getRootDoc && session.getRootDoc();
  const nested = useMemo(() => (root ? readNotesTree(root) : []), [root, session && session.tree]);

  const toggle = (id) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Build the visible row list honoring collapse state (or a flat filtered list when searching).
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q) {
      return flattenTree(nested)
        .filter((n) => (n.title || '').toLowerCase().includes(q))
        .map((n) => ({ node: n, depth: 0, hasChildren: false }));
    }
    const out = [];
    const walk = (nodes, depth) => {
      for (const n of nodes) {
        const kids = n.children || [];
        out.push({ node: n, depth, hasChildren: kids.length > 0 });
        if (kids.length && expanded.has(n.id)) walk(kids, depth + 1);
      }
    };
    walk(nested, 0);
    return out;
  }, [nested, expanded, query]);

  const initial = (team?.teamName || 'T').trim().charAt(0).toUpperCase() || 'T';

  return (
    <View style={[sb.container, { backgroundColor: c.sidebar }]}>
      {/* Workspace switcher header */}
      <TouchableOpacity style={sb.workspace} activeOpacity={0.6} onPress={onOpenSwitcher}>
        <View style={[sb.wsIcon, { backgroundColor: c.accent }]}>
          <Text style={sb.wsIconText}>{initial}</Text>
        </View>
        <Text numberOfLines={1} style={[sb.wsName, { color: c.text }]}>
          {team?.teamName || 'Untitled team'}
        </Text>
        <Ionicons name="chevron-expand" size={16} color={c.faint} />
      </TouchableOpacity>

      {/* Search */}
      <View style={[sb.search, { backgroundColor: c.surface, borderColor: c.border }]}>
        <Ionicons name="search" size={16} color={c.faint} />
        <TextInput
          style={[sb.searchInput, { color: c.text }]}
          value={query}
          onChangeText={setQuery}
          placeholder="Search pages"
          placeholderTextColor={c.faint}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {query ? (
          <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
            <Ionicons name="close-circle" size={16} color={c.faint} />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Quick rows */}
      <Pressable onPress={onOpenSettings} style={({ pressed }) => [sb.quick, pressed && { backgroundColor: c.pressed }]}>
        <Ionicons name="settings-outline" size={18} color={c.muted} style={{ width: 26 }} />
        <Text style={[sb.quickText, { color: c.text }]}>Settings</Text>
      </Pressable>

      {/* Page tree */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 6 }} keyboardShouldPersistTaps="handled">
        <View style={sb.treeHeadRow}>
          <Text style={[sb.treeHead, { color: c.faint }]}>Pages</Text>
          <TouchableOpacity onPress={() => onNewPage(null)} hitSlop={10}>
            <Ionicons name="add" size={18} color={c.faint} />
          </TouchableOpacity>
        </View>

        {rows.length === 0 ? (
          <Text style={[sb.empty, { color: c.faint }]}>
            {session && session.status && session.status.peers > 0
              ? 'No pages yet'
              : 'Waiting for a desktop peer…'}
          </Text>
        ) : (
          rows.map(({ node, depth, hasChildren }) => (
            <PageRow
              key={node.id}
              node={node}
              depth={depth}
              hasChildren={hasChildren}
              expanded={expanded.has(node.id)}
              active={node.id === activeNoteId}
              onToggle={toggle}
              onOpen={(n) => onSelectNote(n)}
              onLongPress={(n) => onNoteActions(n)}
              teamId={team?.teamId}
              c={c}
            />
          ))
        )}

        <Pressable onPress={() => onNewPage(null)} style={({ pressed }) => [sb.newPage, pressed && { backgroundColor: c.pressed }]}>
          <Ionicons name="add" size={18} color={c.faint} style={{ width: 26 }} />
          <Text style={[sb.newPageText, { color: c.muted }]}>New page</Text>
        </Pressable>
      </ScrollView>

      {/* Membership footer */}
      <Pressable onPress={onOpenMembership} style={({ pressed }) => [sb.footer, { borderTopColor: c.divider }, pressed && { backgroundColor: c.pressed }]}>
        {identity ? (
          <View style={[sb.avatar, { backgroundColor: identity.color }]}>
            <Text style={sb.avatarText}>{(identity.username || '?').charAt(0).toUpperCase()}</Text>
          </View>
        ) : (
          <View style={[sb.avatar, { backgroundColor: c.border }]}>
            <Ionicons name="person" size={14} color={c.faint} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={[sb.footerName, { color: c.text }]}>
            {identity ? identity.username : 'Join this team'}
          </Text>
          <Text numberOfLines={1} style={[sb.footerSub, { color: c.faint }]}>
            {online > 1 ? `${online} online` : identity ? 'Member' : 'Tap to claim your identity'}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={c.faint} />
      </Pressable>
    </View>
  );
}

const sb = StyleSheet.create({
  container: { flex: 1, paddingTop: TOP_INSET + 6 },
  workspace: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  wsIcon: { width: 26, height: 26, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  wsIconText: { color: '#fff', fontSize: 14, fontWeight: '700', fontFamily: FONT },
  wsName: { flex: 1, fontSize: 15, fontWeight: '600', fontFamily: FONT },

  search: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 12, marginTop: 6, marginBottom: 4, paddingHorizontal: 10, paddingVertical: 8, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, gap: 6 },
  searchInput: { flex: 1, fontSize: 15, padding: 0, fontFamily: FONT },

  quick: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 9 },
  quickText: { fontSize: 15, fontFamily: FONT },

  treeHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4 },
  treeHead: { fontSize: 12, fontWeight: '600', letterSpacing: 0.4, textTransform: 'uppercase', fontFamily: FONT },
  empty: { paddingHorizontal: 16, paddingVertical: 14, fontSize: 13, fontFamily: FONT },

  newPage: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, marginTop: 4 },
  newPageText: { fontSize: 15, fontFamily: FONT },

  footer: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, gap: 10 },
  avatar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 13, fontWeight: '700', fontFamily: FONT },
  footerName: { fontSize: 14, fontWeight: '600', fontFamily: FONT },
  footerSub: { fontSize: 11, marginTop: 1, fontFamily: FONT },
});

const srow = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingRight: 10, paddingVertical: 7, borderRadius: radius.sm, marginHorizontal: 6 },
  toggle: { width: 18, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 15, fontFamily: FONT },
});
