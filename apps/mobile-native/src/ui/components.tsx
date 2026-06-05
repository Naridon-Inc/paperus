// @ts-nocheck
/**
 * components.tsx — shared, theme-aware UI primitives in Notion's mobile style.
 * Every piece reads colors through useThemeColors() so light/dark follow the OS.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors, radius, FONT, TOP_INSET } from './theme';

export function Icon({ name, size = 20, color, style }) {
  const c = useThemeColors();
  return <Ionicons name={name} size={size} color={color || c.text} style={style} />;
}

/** Slim top bar for a page: optional left (menu/back) + title + right actions. */
export function TopBar({ left, title, right, subtitle }) {
  const c = useThemeColors();
  return (
    <View style={[s.topbar, { borderBottomColor: c.divider }]}>
      <View style={s.topbarSide}>{left || null}</View>
      <View style={s.topbarCenter}>
        {title ? (
          <Text numberOfLines={1} style={[s.topbarTitle, { color: c.text }]}>
            {title}
          </Text>
        ) : null}
        {subtitle ? (
          <Text numberOfLines={1} style={[s.topbarSub, { color: c.faint }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={[s.topbarSide, { alignItems: 'flex-end' }]}>{right || null}</View>
    </View>
  );
}

export function IconButton({ name, onPress, color, size = 22, hitSlop = 12 }) {
  const c = useThemeColors();
  return (
    <TouchableOpacity onPress={onPress} hitSlop={hitSlop} style={s.iconBtn} activeOpacity={0.6}>
      <Ionicons name={name} size={size} color={color || c.text} />
    </TouchableOpacity>
  );
}

/** Full-screen modal sheet with a Notion-style header (Cancel / title / action). */
export function Sheet({ visible, onClose, title, headerAction, children, animationType = 'slide' }) {
  const c = useThemeColors();
  return (
    <Modal visible={visible} onRequestClose={onClose} animationType={animationType} transparent={false} presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        <View style={[s.sheetHead, { borderBottomColor: c.divider }]}>
          <TouchableOpacity onPress={onClose} hitSlop={10} style={s.sheetCancel}>
            <Text style={[s.sheetCancelText, { color: c.muted }]}>Cancel</Text>
          </TouchableOpacity>
          <Text numberOfLines={1} style={[s.sheetTitle, { color: c.text }]}>
            {title}
          </Text>
          <View style={s.sheetAction}>{headerAction || <View style={{ width: 50 }} />}</View>
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {children}
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

export function PrimaryButton({ title, onPress, disabled, loading, icon }) {
  const c = useThemeColors();
  return (
    <TouchableOpacity
      style={[s.primary, { backgroundColor: c.accent }, (disabled || loading) && { opacity: 0.45 }]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.85}
    >
      {loading ? (
        <ActivityIndicator color={c.onAccent} />
      ) : (
        <View style={s.row}>
          {icon ? <Ionicons name={icon} size={18} color={c.onAccent} style={{ marginRight: 8 }} /> : null}
          <Text style={[s.primaryText, { color: c.onAccent }]}>{title}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

export function GhostButton({ title, onPress, color, icon }) {
  const c = useThemeColors();
  return (
    <TouchableOpacity style={s.ghost} onPress={onPress} activeOpacity={0.6}>
      <View style={s.row}>
        {icon ? <Ionicons name={icon} size={18} color={color || c.muted} style={{ marginRight: 8 }} /> : null}
        <Text style={[s.ghostText, { color: color || c.muted }]}>{title}</Text>
      </View>
    </TouchableOpacity>
  );
}

/** A tappable list row in the Notion settings/menu style: icon + label + optional value/chevron. */
export function ListRow({ icon, iconColor, label, value, onPress, danger, last }) {
  const c = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        s.listRow,
        { borderBottomColor: c.divider, borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth },
        pressed && { backgroundColor: c.hover },
      ]}
    >
      {icon ? <Ionicons name={icon} size={20} color={danger ? c.danger : iconColor || c.muted} style={{ width: 28 }} /> : null}
      <Text style={[s.listLabel, { color: danger ? c.danger : c.text }]} numberOfLines={1}>
        {label}
      </Text>
      {value ? <Text style={[s.listValue, { color: c.faint }]} numberOfLines={1}>{value}</Text> : null}
      {onPress && !danger ? <Ionicons name="chevron-forward" size={16} color={c.faint} /> : null}
    </Pressable>
  );
}

export function Spinner({ label }) {
  const c = useThemeColors();
  return (
    <View style={s.spinner}>
      <ActivityIndicator size="large" color={c.accent} />
      {label ? <Text style={[s.spinnerLabel, { color: c.muted }]}>{label}</Text> : null}
    </View>
  );
}

export function SectionLabel({ children }) {
  const c = useThemeColors();
  return <Text style={[s.sectionLabel, { color: c.faint }]}>{children}</Text>;
}

/** Imperative prompt: const [node, ask] = usePrompt(); const v = await ask({title}). */
export function usePrompt() {
  const [state, setState] = useState(null);
  const ask = useCallback(
    (opts = {}) =>
      new Promise((resolve) => {
        setState({
          title: opts.title || '',
          placeholder: opts.placeholder || '',
          initialValue: opts.initialValue || '',
          confirmLabel: opts.confirmLabel || 'Done',
          secure: !!opts.secure,
          autoCapitalize: opts.autoCapitalize || 'sentences',
          resolve,
        });
      }),
    [],
  );
  const node = state ? (
    <PromptModal
      {...state}
      onClose={(val) => {
        state.resolve(val);
        setState(null);
      }}
    />
  ) : null;
  return [node, ask];
}

function PromptModal({ title, placeholder, initialValue, confirmLabel, secure, autoCapitalize, onClose }) {
  const c = useThemeColors();
  const [val, setVal] = useState(initialValue);
  useEffect(() => setVal(initialValue), [initialValue]);
  return (
    <Modal transparent animationType="fade" onRequestClose={() => onClose(null)}>
      <View style={[s.promptBackdrop, { backgroundColor: c.overlay }]}>
        <View style={[s.promptCard, { backgroundColor: c.surface, borderColor: c.border }]}>
          {title ? <Text style={[s.promptTitle, { color: c.text }]}>{title}</Text> : null}
          <TextInput
            style={[s.promptInput, { backgroundColor: c.surfaceAlt, color: c.text, borderColor: c.border }]}
            value={val}
            onChangeText={setVal}
            placeholder={placeholder}
            placeholderTextColor={c.faint}
            autoFocus
            autoCapitalize={autoCapitalize}
            autoCorrect={false}
            secureTextEntry={secure}
          />
          <View style={s.promptActions}>
            <TouchableOpacity onPress={() => onClose(null)} style={s.promptBtn}>
              <Text style={[s.promptCancel, { color: c.muted }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => onClose(val)} style={s.promptBtn}>
              <Text style={[s.promptConfirm, { color: c.accent }]}>{confirmLabel}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  iconBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },

  topbar: { flexDirection: 'row', alignItems: 'center', height: 48 + TOP_INSET, paddingTop: TOP_INSET, paddingHorizontal: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  topbarSide: { minWidth: 44, flexDirection: 'row', alignItems: 'center' },
  topbarCenter: { flex: 1, alignItems: 'center', paddingHorizontal: 4 },
  topbarTitle: { fontSize: 15, fontWeight: '600', fontFamily: FONT },
  topbarSub: { fontSize: 11, marginTop: 1, fontFamily: FONT },

  sheetHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 14, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  sheetCancel: { minWidth: 60 },
  sheetCancelText: { fontSize: 16, fontFamily: FONT },
  sheetTitle: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '600', fontFamily: FONT },
  sheetAction: { minWidth: 60, alignItems: 'flex-end' },

  primary: { borderRadius: radius.md, paddingVertical: 14, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontSize: 15, fontWeight: '600', fontFamily: FONT },
  ghost: { paddingVertical: 13, alignItems: 'center', justifyContent: 'center' },
  ghostText: { fontSize: 15, fontWeight: '500', fontFamily: FONT },

  listRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, gap: 4 },
  listLabel: { flex: 1, fontSize: 16, fontFamily: FONT },
  listValue: { fontSize: 15, marginRight: 6, fontFamily: FONT },

  spinner: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 40 },
  spinnerLabel: { fontSize: 14, textAlign: 'center', lineHeight: 20, fontFamily: FONT },

  sectionLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 0.4, textTransform: 'uppercase', marginTop: 22, marginBottom: 8, marginHorizontal: 16, fontFamily: FONT },

  promptBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  promptCard: { borderRadius: radius.lg, padding: 18, width: '100%', maxWidth: 380, borderWidth: StyleSheet.hairlineWidth },
  promptTitle: { fontSize: 16, fontWeight: '600', marginBottom: 12, fontFamily: FONT },
  promptInput: { borderRadius: radius.sm, padding: 12, fontSize: 16, borderWidth: StyleSheet.hairlineWidth, fontFamily: FONT },
  promptActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 14, gap: 6 },
  promptBtn: { paddingVertical: 8, paddingHorizontal: 14 },
  promptCancel: { fontSize: 16, fontFamily: FONT },
  promptConfirm: { fontSize: 16, fontWeight: '700', fontFamily: FONT },
});
