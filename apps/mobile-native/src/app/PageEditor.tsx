// @ts-nocheck
/**
 * PageEditor.tsx — a Notion-style page for one note: optional cover band, a large
 * page icon, a big title, and the body.
 *
 * Body sync (no yCollab on RN): the editor TextInput drives local keystrokes; each
 * change is reduced to a minimal common-prefix/suffix delete+insert applied to the
 * per-note `Y.Text('content')` in a `'local-edit'` transaction. The Y.Text observer
 * ignores its own origin and pulls remote (desktop) edits in live. The page reads
 * as rendered Markdown by default and flips to a raw-Markdown edit mode.
 *
 * Title lives in the team ROOT doc (renameNote); body in the per-note doc. Page
 * icon + cover are LOCAL decorations (see store/decorations) — never written to the
 * shared CRDT.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Markdown from 'react-native-markdown-display';
import { Ionicons } from '@expo/vector-icons';
import { TopBar, IconButton, Spinner } from '../ui/components';
import { useThemeColors, FONT, MONO, radius, ICON_COLORS, COVER_COLORS } from '../ui/theme';
import { makeMarkdownStyles } from '../ui/markdown-styles';
import { renameNote } from '../engine/note-ops';
import { getDecoration, setDecoration } from '../store/decorations';

const PICKER_ICONS = [
  'document-text-outline', 'book-outline', 'bookmark-outline', 'bulb-outline', 'rocket-outline',
  'flag-outline', 'flame-outline', 'star-outline', 'heart-outline', 'checkbox-outline',
  'calendar-outline', 'briefcase-outline', 'code-slash-outline', 'cube-outline', 'compass-outline',
  'leaf-outline', 'musical-notes-outline', 'pizza-outline',
];

function applyDiff(ytext, prev, next, doc) {
  if (prev === next) return;
  const a = prev.length;
  const b = next.length;
  let p = 0;
  const max = Math.min(a, b);
  while (p < max && prev[p] === next[p]) p += 1;
  let sfx = 0;
  while (sfx < max - p && prev[a - 1 - sfx] === next[b - 1 - sfx]) sfx += 1;
  const delCount = a - p - sfx;
  const insStr = next.slice(p, b - sfx);
  doc.transact(() => {
    if (delCount > 0) ytext.delete(p, delCount);
    if (insStr.length > 0) ytext.insert(p, insStr);
  }, 'local-edit');
}

function IconPicker({ visible, onPick, onClear, onClose }) {
  const c = useThemeColors();
  const [color, setColor] = useState(ICON_COLORS[0]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={[pk.backdrop, { backgroundColor: c.overlay }]} onPress={onClose}>
        <Pressable style={[pk.card, { backgroundColor: c.surface, borderColor: c.border }]}>
          <View style={pk.colorRow}>
            {ICON_COLORS.map((col) => (
              <TouchableOpacity
                key={col}
                onPress={() => setColor(col)}
                style={[pk.swatch, { backgroundColor: col }, color === col && { borderColor: c.text, borderWidth: 2 }]}
              />
            ))}
          </View>
          <View style={pk.grid}>
            {PICKER_ICONS.map((name) => (
              <TouchableOpacity key={name} style={pk.gridItem} onPress={() => onPick(name, color)}>
                <Ionicons name={name} size={26} color={color} />
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity onPress={onClear} style={pk.remove}>
            <Text style={[pk.removeText, { color: c.danger }]}>Remove icon</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function PageEditor({ session, teamId, note, onMenu, onActions }) {
  const c = useThemeColors();
  const noteId = note.id;
  const mdStyles = useMemo(() => makeMarkdownStyles(c), [c]);

  const [loading, setLoading] = useState(true);
  const [value, setValue] = useState('');
  const [mode, setMode] = useState('read'); // 'read' | 'edit'
  const [title, setTitle] = useState(note.title || '');
  const [deco, setDeco] = useState(() => getDecoration(teamId, noteId));
  const [pickerOpen, setPickerOpen] = useState(false);
  const titleFocused = useRef(false);

  const ytextRef = useRef(null);
  const docRef = useRef(null);
  const valueRef = useRef('');
  valueRef.current = value;

  // keep title in sync with the live root doc (unless we're editing it)
  useEffect(() => {
    if (!session) return undefined;
    const sync = () => {
      const n = session.tree.find((x) => x.id === noteId);
      if (n && !titleFocused.current) setTitle(n.title || '');
    };
    sync();
    return session.subscribe(sync);
  }, [session, noteId]);

  // open the per-note doc + bind the Y.Text
  useEffect(() => {
    if (!session) return undefined;
    let observer = null;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const entry = await session.openNote(noteId);
        if (cancelled) return;
        const ytext = entry.text;
        ytextRef.current = ytext;
        docRef.current = entry.handle.doc;
        const initial = ytext.toString();
        setValue(initial);
        setMode(initial.trim() ? 'read' : 'edit'); // new/empty page opens ready to type
        observer = (_event, tr) => {
          if (tr && tr.origin === 'local-edit') return;
          const str = ytext.toString();
          if (str !== valueRef.current) setValue(str);
        };
        ytext.observe(observer);
      } catch (_e) {
        /* leave empty */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      try {
        if (observer && ytextRef.current) ytextRef.current.unobserve(observer);
      } catch (_e) {
        /* noop */
      }
    };
  }, [session, noteId]);

  const onChangeBody = (next) => {
    const ytext = ytextRef.current;
    const doc = docRef.current;
    if (ytext && doc) applyDiff(ytext, valueRef.current, next, doc);
    setValue(next);
  };

  const onChangeTitle = (next) => {
    setTitle(next);
    const root = session && session.getRootDoc();
    if (root) renameNote(root, noteId, next.trim() || 'Untitled');
  };

  const saveDeco = async (patch) => {
    setDeco((d) => ({ ...d, ...patch }));
    await setDecoration(teamId, noteId, patch);
  };

  const cycleCover = async () => {
    const idx = COVER_COLORS.indexOf(deco.cover);
    const next = COVER_COLORS[(idx + 1) % COVER_COLORS.length];
    await saveDeco({ cover: next });
  };

  const hasIcon = !!deco.icon;
  const hasCover = !!deco.cover;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <TopBar
        left={<IconButton name="menu" onPress={onMenu} />}
        title={title || 'Untitled'}
        right={
          <View style={{ flexDirection: 'row' }}>
            <IconButton name={mode === 'read' ? 'create-outline' : 'eye-outline'} onPress={() => setMode((m) => (m === 'read' ? 'edit' : 'read'))} />
            <IconButton name="ellipsis-horizontal" onPress={() => onActions(note)} />
          </View>
        }
      />

      {loading ? (
        <Spinner label="Opening page…" />
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 80 }} keyboardShouldPersistTaps="handled">
            {/* Cover */}
            {hasCover ? (
              <Pressable onPress={cycleCover} onLongPress={() => saveDeco({ cover: null })}>
                <View style={[pe.cover, { backgroundColor: deco.cover }]} />
              </Pressable>
            ) : null}

            <View style={pe.pageBody}>
              {/* Icon */}
              {hasIcon ? (
                <TouchableOpacity onPress={() => setPickerOpen(true)} style={[pe.iconWrap, hasCover && { marginTop: -34 }]}>
                  <Ionicons name={deco.icon} size={44} color={deco.iconColor || c.muted} />
                </TouchableOpacity>
              ) : null}

              {/* Add icon / cover affordances */}
              {!hasIcon || !hasCover ? (
                <View style={pe.addRow}>
                  {!hasIcon ? (
                    <TouchableOpacity style={pe.addBtn} onPress={() => setPickerOpen(true)}>
                      <Ionicons name="happy-outline" size={15} color={c.faint} />
                      <Text style={[pe.addText, { color: c.faint }]}>Add icon</Text>
                    </TouchableOpacity>
                  ) : null}
                  {!hasCover ? (
                    <TouchableOpacity style={pe.addBtn} onPress={cycleCover}>
                      <Ionicons name="image-outline" size={15} color={c.faint} />
                      <Text style={[pe.addText, { color: c.faint }]}>Add cover</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : null}

              {/* Title */}
              <TextInput
                style={[pe.title, { color: c.textHi }]}
                value={title}
                onChangeText={onChangeTitle}
                onFocus={() => {
                  titleFocused.current = true;
                }}
                onBlur={() => {
                  titleFocused.current = false;
                }}
                placeholder="Untitled"
                placeholderTextColor={c.faint}
                multiline
              />

              {/* Body */}
              {mode === 'read' ? (
                <Pressable onPress={() => setMode('edit')} style={{ minHeight: 240 }}>
                  {value.trim() ? (
                    <Markdown style={mdStyles}>{value}</Markdown>
                  ) : (
                    <Text style={[pe.placeholder, { color: c.faint }]}>Tap to start writing… Markdown supported.</Text>
                  )}
                </Pressable>
              ) : (
                <TextInput
                  style={[pe.body, { color: c.text }]}
                  value={value}
                  onChangeText={onChangeBody}
                  placeholder="Start writing… Markdown supported."
                  placeholderTextColor={c.faint}
                  multiline
                  autoCapitalize="sentences"
                  textAlignVertical="top"
                  autoFocus={!value.trim()}
                  scrollEnabled={false}
                />
              )}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      <IconPicker
        visible={pickerOpen}
        onPick={(name, color) => {
          saveDeco({ icon: name, iconColor: color });
          setPickerOpen(false);
        }}
        onClear={() => {
          saveDeco({ icon: null });
          setPickerOpen(false);
        }}
        onClose={() => setPickerOpen(false)}
      />
    </View>
  );
}

const pe = StyleSheet.create({
  cover: { height: 120, width: '100%' },
  pageBody: { paddingHorizontal: 22, paddingTop: 14 },
  iconWrap: { width: 60, height: 60, alignItems: 'flex-start', justifyContent: 'center' },
  addRow: { flexDirection: 'row', gap: 16, marginTop: 6, marginBottom: 4 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4 },
  addText: { fontSize: 13, fontFamily: FONT },
  title: { fontSize: 30, fontWeight: '800', paddingVertical: 8, fontFamily: FONT, lineHeight: 36 },
  placeholder: { fontSize: 16, paddingTop: 6, fontFamily: FONT },
  body: { fontSize: 16, lineHeight: 26, paddingTop: 4, minHeight: 260, fontFamily: FONT },
});

const pk = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 380, borderRadius: radius.lg, padding: 16, borderWidth: StyleSheet.hairlineWidth },
  colorRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14, paddingHorizontal: 2 },
  swatch: { width: 26, height: 26, borderRadius: 13, borderColor: 'transparent' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  gridItem: { width: '16.66%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  remove: { marginTop: 12, alignItems: 'center', paddingVertical: 8 },
  removeText: { fontSize: 14, fontWeight: '500', fontFamily: FONT },
});
