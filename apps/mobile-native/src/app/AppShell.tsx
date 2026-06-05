// @ts-nocheck
/**
 * AppShell — the Notion-style shell. Holds the active team + active page, a
 * slide-in left Sidebar (workspace switcher + page tree), the full PageEditor in
 * the main pane, and the secondary flows as modal sheets (add-team, switcher,
 * settings, membership, page actions). The engine/store layer is reused verbatim;
 * this is purely the presentation shell that replaced the old stack navigator.
 */
import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Linking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors, radius, FONT } from '../ui/theme';
import { TopBar, IconButton, PrimaryButton, usePrompt } from '../ui/components';
import Sidebar from './Sidebar';
import PageEditor from './PageEditor';
import WorkspaceSwitcher from './WorkspaceSwitcher';
import AddTeamSheet from './sheets/AddTeamSheet';
import SettingsSheet from './sheets/SettingsSheet';
import MembershipSheet from './sheets/MembershipSheet';
import { getTeams, getTeam, onTeamsChange } from '../store/teams';
import { getSession, dropSession } from '../store/sessions';
import { getIdentity, onSettingsChange } from '../store/settings';
import { loadDecorations, onDecorationsChange } from '../store/decorations';
import { createNote, renameNote, deleteNote } from '../engine/note-ops';

const { width: SCREEN_W } = Dimensions.get('window');
const DRAWER_W = Math.min(330, Math.round(SCREEN_W * 0.86));

function isJoinLink(url) {
  if (!url) return false;
  const s = String(url);
  return /notionless-team|notionless-pair|[?#&]team=|[?#&]pair=/.test(s);
}

export default function AppShell() {
  const c = useThemeColors();
  const [, force] = useReducer((n) => n + 1, 0);
  const [promptNode, prompt] = usePrompt();

  const [activeTeamId, setActiveTeamId] = useState(null);
  const [activeNoteId, setActiveNoteId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [modal, setModal] = useState(null); // {kind, ...}
  const [pendingLink, setPendingLink] = useState(null);

  const anim = useRef(new Animated.Value(0)).current;

  // boot: load local decorations + pick the first team
  useEffect(() => {
    loadDecorations().then(force);
    const teams = getTeams();
    if (teams.length && !activeTeamId) setActiveTeamId(teams[0].teamId);
  }, []);

  // global store subscriptions
  useEffect(() => {
    const a = onTeamsChange(force);
    const b = onSettingsChange(force);
    const d = onDecorationsChange(force);
    return () => {
      a();
      b();
      d();
    };
  }, []);

  const session = activeTeamId ? getSession(activeTeamId) : null;
  const team = activeTeamId ? getTeam(activeTeamId) : null;
  const identity = activeTeamId ? getIdentity(activeTeamId) : null;

  // re-render on this team's live session changes (tree, status, presence)
  useEffect(() => {
    if (!session) return undefined;
    return session.subscribe(force);
  }, [session]);

  // auto-open the first available page when a team is active but nothing is selected
  useEffect(() => {
    if (!session || activeNoteId) return;
    const first = (session.tree || []).find((n) => !n.locked);
    if (first) setActiveNoteId(first.id);
  }, [session, activeNoteId, session && session.tree]);

  const note = useMemo(() => {
    if (!session || !activeNoteId) return null;
    return (session.tree || []).find((n) => n.id === activeNoteId) || null;
  }, [session, activeNoteId, session && session.tree]);

  // drawer animation
  useEffect(() => {
    Animated.timing(anim, {
      toValue: sidebarOpen ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [sidebarOpen]);

  // deep links → open the join sheet prefilled
  useEffect(() => {
    let sub;
    Linking.getInitialURL().then((url) => {
      if (isJoinLink(url)) {
        setPendingLink(url);
        setModal({ kind: 'addTeam' });
      }
    });
    sub = Linking.addEventListener('url', ({ url }) => {
      if (isJoinLink(url)) {
        setPendingLink(url);
        setModal({ kind: 'addTeam' });
      }
    });
    return () => sub && sub.remove();
  }, []);

  const openDrawer = () => setSidebarOpen(true);
  const closeDrawer = () => setSidebarOpen(false);

  const selectNote = (n) => {
    setActiveNoteId(n.id);
    closeDrawer();
  };

  const switchTeam = (t) => {
    setActiveTeamId(t.teamId);
    setActiveNoteId(null);
    setModal(null);
  };

  const newPage = async (parentId) => {
    const root = session && session.getRootDoc();
    if (!root) return;
    const title = await prompt({ title: 'New page', placeholder: 'Page title', confirmLabel: 'Create' });
    if (title === null) return;
    const id = createNote(root, { title: (title || '').trim() || 'Untitled', parentId: parentId || null });
    setActiveNoteId(id);
    closeDrawer();
  };

  const noteActions = (n) => setModal({ kind: 'noteActions', note: n });

  const doRename = async (n) => {
    setModal(null);
    const root = session && session.getRootDoc();
    if (!root) return;
    const next = await prompt({ title: 'Rename page', initialValue: n.title || '', confirmLabel: 'Rename' });
    if (next === null) return;
    renameNote(root, n.id, (next || '').trim() || 'Untitled');
  };

  const doDelete = (n) => {
    setModal(null);
    const root = session && session.getRootDoc();
    if (!root) return;
    deleteNote(root, n.id);
    if (activeNoteId === n.id) setActiveNoteId(null);
  };

  const onTeamLeft = (leftId) => {
    setModal(null);
    const remaining = getTeams().filter((t) => t.teamId !== leftId);
    setActiveTeamId(remaining.length ? remaining[0].teamId : null);
    setActiveNoteId(null);
  };

  const backdropOpacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0, 0.45] });
  const drawerX = anim.interpolate({ inputRange: [0, 1], outputRange: [-DRAWER_W, 0] });

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <StatusBar style={c.mode === 'dark' ? 'light' : 'dark'} />

      {/* Main pane */}
      {team && note ? (
        <PageEditor
          key={`${activeTeamId}:${note.id}`}
          session={session}
          teamId={activeTeamId}
          note={note}
          onMenu={openDrawer}
          onActions={noteActions}
        />
      ) : (
        <HomePane
          c={c}
          team={team}
          session={session}
          onMenu={openDrawer}
          onAddTeam={() => {
            setPendingLink(null);
            setModal({ kind: 'addTeam' });
          }}
          onNewPage={() => newPage(null)}
        />
      )}

      {/* Drawer overlay */}
      <View style={StyleSheet.absoluteFill} pointerEvents={sidebarOpen ? 'auto' : 'none'}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: backdropOpacity }]}>
          <Pressable style={{ flex: 1 }} onPress={closeDrawer} />
        </Animated.View>
        <Animated.View style={[ash.drawer, { width: DRAWER_W, transform: [{ translateX: drawerX }], backgroundColor: c.sidebar, borderRightColor: c.border }]}>
          <Sidebar
            team={team}
            session={session}
            activeNoteId={activeNoteId}
            online={session ? session.online : 0}
            identity={identity}
            onSelectNote={selectNote}
            onOpenSwitcher={() => setModal({ kind: 'switcher' })}
            onOpenSettings={() => setModal({ kind: 'settings' })}
            onOpenMembership={() => setModal({ kind: 'membership', teamId: activeTeamId })}
            onNewPage={newPage}
            onNoteActions={noteActions}
          />
        </Animated.View>
      </View>

      {/* Sheets */}
      <WorkspaceSwitcher
        visible={modal?.kind === 'switcher'}
        activeTeamId={activeTeamId}
        onClose={() => setModal(null)}
        onSelect={switchTeam}
        onAddTeam={() => {
          setPendingLink(null);
          setModal({ kind: 'addTeam' });
        }}
      />
      <AddTeamSheet
        visible={modal?.kind === 'addTeam'}
        initialLink={pendingLink}
        onClose={() => setModal(null)}
        onJoined={(teamId) => {
          setActiveTeamId(teamId);
          setActiveNoteId(null);
          setPendingLink(null);
          setModal(null);
        }}
      />
      <SettingsSheet visible={modal?.kind === 'settings'} onClose={() => setModal(null)} />
      <MembershipSheet
        visible={modal?.kind === 'membership'}
        teamId={modal?.kind === 'membership' ? modal.teamId : null}
        onClose={() => setModal(null)}
        onLeft={onTeamLeft}
      />

      {/* Page actions */}
      <NoteActionsModal
        visible={modal?.kind === 'noteActions'}
        note={modal?.kind === 'noteActions' ? modal.note : null}
        c={c}
        onClose={() => setModal(null)}
        onNewSubpage={(n) => {
          setModal(null);
          newPage(n.id);
        }}
        onRename={doRename}
        onDelete={doDelete}
      />

      {promptNode}
    </View>
  );
}

function HomePane({ c, team, session, onMenu, onAddTeam, onNewPage }) {
  const hasTeam = !!team;
  const peers = session && session.status ? session.status.peers : 0;
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <TopBar
        left={<IconButton name="menu" onPress={onMenu} />}
        title={hasTeam ? team.teamName || 'Untitled team' : 'Notionless'}
      />
      <View style={ash.home}>
        <View style={[ash.homeIcon, { backgroundColor: c.surfaceAlt }]}>
          <Ionicons name={hasTeam ? 'documents-outline' : 'people-outline'} size={30} color={c.faint} />
        </View>
        {hasTeam ? (
          <>
            <Text style={[ash.homeTitle, { color: c.text }]}>No page open</Text>
            <Text style={[ash.homeSub, { color: c.faint }]}>
              {peers > 0 ? 'Open the menu to pick a page, or create one.' : 'Waiting for a desktop peer to sync the page tree…'}
            </Text>
            <View style={{ height: 18 }} />
            <View style={{ width: 220 }}>
              <PrimaryButton title="New page" icon="add" onPress={onNewPage} />
            </View>
          </>
        ) : (
          <>
            <Text style={[ash.homeTitle, { color: c.text }]}>Welcome to Notionless</Text>
            <Text style={[ash.homeSub, { color: c.faint }]}>
              Join a team from your desktop with a team link or QR code. Everything stays end-to-end
              encrypted and peer-to-peer.
            </Text>
            <View style={{ height: 18 }} />
            <View style={{ width: 220 }}>
              <PrimaryButton title="Add a team" icon="add" onPress={onAddTeam} />
            </View>
          </>
        )}
      </View>
    </View>
  );
}

function NoteActionsModal({ visible, note, c, onClose, onNewSubpage, onRename, onDelete }) {
  if (!note) return null;
  const locked = !!note.locked;
  const Row = ({ icon, label, danger, onPress }) => (
    <TouchableOpacity style={ash.actRow} onPress={onPress} activeOpacity={0.6}>
      <Ionicons name={icon} size={20} color={danger ? c.danger : c.muted} style={{ width: 30 }} />
      <Text style={[ash.actLabel, { color: danger ? c.danger : c.text }]}>{label}</Text>
    </TouchableOpacity>
  );
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={[ash.actBackdrop, { backgroundColor: c.overlay }]} onPress={onClose}>
        <Pressable style={[ash.actSheet, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Text numberOfLines={1} style={[ash.actTitle, { color: c.faint }]}>
            {note.title || 'Untitled'}
          </Text>
          <Row icon="add-outline" label="New subpage" onPress={() => onNewSubpage(note)} />
          {!locked ? <Row icon="create-outline" label="Rename" onPress={() => onRename(note)} /> : null}
          {!locked ? <Row icon="trash-outline" label="Delete" danger onPress={() => onDelete(note)} /> : null}
          {locked ? <Text style={[ash.actNote, { color: c.faint }]}>Restricted page — manage it on the desktop.</Text> : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const ash = StyleSheet.create({
  drawer: { position: 'absolute', top: 0, bottom: 0, left: 0, borderRightWidth: StyleSheet.hairlineWidth },
  home: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, paddingBottom: 60 },
  homeIcon: { width: 64, height: 64, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  homeTitle: { fontSize: 20, fontWeight: '700', marginBottom: 8, fontFamily: FONT },
  homeSub: { fontSize: 14, textAlign: 'center', lineHeight: 21, fontFamily: FONT },

  actBackdrop: { flex: 1, justifyContent: 'flex-end', padding: 12 },
  actSheet: { borderRadius: radius.lg, paddingVertical: 8, marginBottom: 8, borderWidth: StyleSheet.hairlineWidth },
  actTitle: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 6, fontFamily: FONT },
  actRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16 },
  actLabel: { fontSize: 16, fontFamily: FONT },
  actNote: { fontSize: 12, paddingHorizontal: 18, paddingVertical: 10, fontFamily: FONT },
});
