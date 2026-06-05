// @ts-nocheck
/**
 * markdown-styles.ts — theme-aware style map for react-native-markdown-display,
 * tuned to read like a Notion page body (system font, generous line height,
 * quiet headings, warm code accents).
 */
import { StyleSheet } from 'react-native';
import { FONT, MONO } from './theme';

export function makeMarkdownStyles(c) {
  return {
    body: { color: c.text, fontSize: 16, lineHeight: 26, fontFamily: FONT },
    heading1: { color: c.textHi, fontSize: 28, fontWeight: '700', marginTop: 18, marginBottom: 4, lineHeight: 34, fontFamily: FONT },
    heading2: { color: c.textHi, fontSize: 22, fontWeight: '700', marginTop: 16, marginBottom: 4, lineHeight: 28, fontFamily: FONT },
    heading3: { color: c.textHi, fontSize: 18, fontWeight: '600', marginTop: 14, marginBottom: 2, fontFamily: FONT },
    heading4: { color: c.textHi, fontSize: 16, fontWeight: '600', marginTop: 12, fontFamily: FONT },
    heading5: { color: c.textHi, fontSize: 15, fontWeight: '600', fontFamily: FONT },
    heading6: { color: c.muted, fontSize: 14, fontWeight: '600', fontFamily: FONT },
    paragraph: { marginTop: 0, marginBottom: 10 },
    strong: { fontWeight: '700', color: c.textHi },
    em: { fontStyle: 'italic' },
    s: { textDecorationLine: 'line-through', color: c.muted },
    link: { color: c.accent },
    blockquote: { backgroundColor: c.surfaceAlt, borderLeftColor: c.text, borderLeftWidth: 3, paddingHorizontal: 14, paddingVertical: 8, marginBottom: 12, borderRadius: 2 },
    bullet_list: { marginBottom: 10 },
    ordered_list: { marginBottom: 10 },
    list_item: { marginBottom: 4 },
    code_inline: { backgroundColor: c.codeBg, color: c.codeText, fontFamily: MONO, fontSize: 14, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 },
    code_block: { backgroundColor: c.codeBg, color: c.text, fontFamily: MONO, fontSize: 13, padding: 14, borderRadius: 6, marginBottom: 12 },
    fence: { backgroundColor: c.codeBg, color: c.text, fontFamily: MONO, fontSize: 13, padding: 14, borderRadius: 6, marginBottom: 12 },
    hr: { backgroundColor: c.divider, height: StyleSheet.hairlineWidth, marginVertical: 18 },
    table: { borderColor: c.border, borderWidth: 1, borderRadius: 4, marginBottom: 12 },
    thead: { backgroundColor: c.surfaceAlt },
    th: { padding: 8, color: c.textHi, fontWeight: '600', fontFamily: FONT },
    td: { padding: 8, borderColor: c.border },
    tr: { borderBottomWidth: 1, borderColor: c.border },
  };
}
