/**
 * @notionless/plugin-sdk — TypeScript declarations.
 *
 * FROZEN CONTRACT v1 (apiVersion "1"). These types are authoritative and mirror
 * §2–§5 of docs/PLUGIN_API_CONTRACT.md. They MUST NOT change without bumping
 * apiVersion to "2".
 */

// ---------------------------------------------------------------------------
// Capabilities (§3)
// ---------------------------------------------------------------------------

/** Static capability strings (the `net:<host>` family is expressed via NetCapability). */
export type StaticCapability =
  | 'commands'
  | 'editor'
  | 'ui'
  | 'sections'
  | 'views'
  | 'ai'
  | 'auth'
  | 'teams'
  | 'storage'
  | 'fs:read'
  | 'fs:write'
  | 'clipboard'
  /**
   * ADDITIVE v1: contribute tools the Company Brain's agent loop can call
   * (`ctx.brain`). Low-risk on its own — a tool that does network egress must
   * ALSO declare a `net:<host>` capability, which is sensitive and prompts.
   */
  | 'tools'

/** A per-host network capability, e.g. `net:api.acme.example` or `net:*.acme.example`. */
export type NetCapability = `net:${string}`

export type Capability = StaticCapability | NetCapability

export declare const CAPABILITIES: {
  readonly COMMANDS: 'commands'
  readonly EDITOR: 'editor'
  readonly UI: 'ui'
  readonly SECTIONS: 'sections'
  readonly VIEWS: 'views'
  readonly AI: 'ai'
  readonly AUTH: 'auth'
  readonly TEAMS: 'teams'
  readonly STORAGE: 'storage'
  readonly FS_READ: 'fs:read'
  readonly FS_WRITE: 'fs:write'
  readonly CLIPBOARD: 'clipboard'
  /** ADDITIVE v1: provide tools the Company Brain can call (gates `ctx.brain`). */
  readonly TOOLS: 'tools'
}

export declare const API_VERSION: '1'

export declare function netCapability(host: string, opts?: { wildcard?: boolean }): NetCapability

// ---------------------------------------------------------------------------
// vDOM (§5.7)
// ---------------------------------------------------------------------------

/** Allow-listed vDOM tags (host sanitizes; unknown tags are dropped). */
export type VTag =
  | 'div' | 'span' | 'p'
  | 'h1' | 'h2' | 'h3' | 'h4'
  | 'ul' | 'ol' | 'li'
  | 'a' | 'button' | 'input' | 'textarea' | 'select' | 'option'
  | 'img' | 'pre' | 'code'
  | 'table' | 'thead' | 'tbody' | 'tr' | 'td' | 'th'
  | 'strong' | 'em' | 'br' | 'hr' | 'label' | 'i' | 'svg'

export interface VNode {
  tag: VTag | string
  /** Sanitized attribute map: class,id,href,src,type,value,placeholder,title,role,aria-*,data-* */
  attrs?: Record<string, string>
  /** Event->action map. value is an action id delivered to onEvent({ action }). */
  on?: Record<string, string>
  children?: Array<VNode | string>
}

/** A host-mounted render result: either a sanitized HTML string or a vNode tree. */
export type VDOM = VNode | string

/** Optional ergonomic vDOM element builder. */
export declare function h(
  tag: VTag | string,
  attrs?: (Record<string, string> & { on?: Record<string, string> }) | null,
  children?: Array<VNode | string> | VNode | string
): VNode

// ---------------------------------------------------------------------------
// Manifest (§2)
// ---------------------------------------------------------------------------

export interface ContributedCommand {
  id: string
  title: string
  key?: string
  when?: 'editorFocus' | 'always'
}

export interface ContributedSlash {
  label: string
  icon: string
  md?: string
  mdAfter?: string
  block?: boolean
  command?: string
}

export interface ContributedBlock {
  type: string
  fence?: string
  match?: string
}

export interface ContributedPanel {
  id: string
  title: string
  location: 'right' | 'left' | 'bottom'
}

export interface ContributedSection {
  id: string
  title: string
  order: number
}

export interface ContributedView {
  id: string
  title: string
  icon?: string
}

export interface ContributedNavItem {
  id: string
  label: string
  icon: string
  /** A view id, or `command:<id>`. */
  target: string
}

export interface ContributedToolbarItem {
  id: string
  icon: string
  title: string
}

export interface ContributedStatusItem {
  id: string
  location: 'footer' | 'header'
}

export interface ContributedSettings {
  id: string
  title: string
}

export interface ContributedAIProvider {
  id: string
  label: string
  icon?: string
  retrievalMode?: 'tfidf' | 'hybrid'
}

export interface ContributedLoginMethod {
  id: string
  label: string
}

/** ADDITIVE v1: a declarative Brain-tool slot (the handler binds on activate). */
export interface ContributedTool {
  id: string
  description: string
  parameters?: Record<string, any>
}

export interface ContributedFormat {
  id: string
  label: string
  ext: string
  direction: 'import' | 'export' | 'both'
}

export type TeamHook = 'open' | 'updated'

export interface Contributes {
  commands?: ContributedCommand[]
  slash?: ContributedSlash[]
  blocks?: ContributedBlock[]
  panels?: ContributedPanel[]
  sections?: ContributedSection[]
  views?: ContributedView[]
  navItems?: ContributedNavItem[]
  toolbarItems?: ContributedToolbarItem[]
  statusItems?: ContributedStatusItem[]
  settings?: ContributedSettings[]
  aiProviders?: ContributedAIProvider[]
  loginMethods?: ContributedLoginMethod[]
  formats?: ContributedFormat[]
  teamHooks?: TeamHook[]
  /** ADDITIVE v1: declarative Brain-tool slots (gated by the `tools` capability). */
  tools?: ContributedTool[]
}

export interface PluginManifest {
  /** Reverse-DNS, lowercase: ^[a-z0-9]+(\.[a-z0-9-]+)+$ */
  id: string
  name: string
  /** Semver x.y.z */
  version: string
  /** MUST be "1" for this contract. */
  apiVersion: '1'
  description: string
  author: string
  /** SPDX id, e.g. "MIT". */
  license: string
  /** Relative path to the ESM entry module. No `..`. */
  entry: string
  capabilities: Capability[]
  contributes?: Contributes
  minHostVersion?: string
  icon?: string
}

// ---------------------------------------------------------------------------
// Disposable (§5)
// ---------------------------------------------------------------------------

export interface Disposable {
  dispose(): void
}

/** Disposable that can also re-render its mounted vDOM. */
export interface UpdatableDisposable extends Disposable {
  update(vdom: VDOM): void
}

// ---------------------------------------------------------------------------
// ctx.commands (§5.1)
// ---------------------------------------------------------------------------

export interface CommandRegistration {
  id: string
  title: string
  /** CM6 keybinding, e.g. 'Mod-Shift-S'. */
  key?: string
  when?: 'editorFocus' | 'always'
  run: (payload?: any) => void | Promise<void>
}

export interface CommandsApi {
  register(cmd: CommandRegistration): Disposable
  execute(id: string, payload?: any): Promise<any>
  list(): Promise<Array<{ id: string; title: string }>>
}

// ---------------------------------------------------------------------------
// ctx.editor (§5.2)
// ---------------------------------------------------------------------------

export interface BlockMatch {
  node: 'FencedCode' | 'Blockquote' | 'HTMLBlock' | 'Table'
  test: RegExp | string
}

export interface BlockRegistration<Model = any> {
  /** Unique within the plugin. */
  type: string
  /** Provide ONE of fence/match. e.g. ':::tip'. */
  fence?: string
  match?: BlockMatch
  parseMarkdown: (raw: string) => Model
  render: (model: Model) => VDOM
  toMarkdown: (model: Model) => string
  /** false ⇒ ignoreEvent; true ⇒ edits dispatch via host. Default false. */
  interactive?: boolean
}

export interface DecorationRegistration {
  /** overlap-SAFE Decoration.mark only. */
  scan: (text: string) => Array<{
    from: number
    to: number
    class: string
    attrs?: Record<string, string>
  }>
}

export interface EditorChangeEvent {
  docId: string
  text: string
  changedRanges: Array<{ from: number; to: number }>
}

export interface ActiveEditorState {
  docId: string | null
  text: string
  selection: { from: number; to: number }
}

export interface EditorInsertPayload {
  text: string
  /** default = current cursor; host clamps to [0, docLen]. */
  at?: number
  replaceSelection?: boolean
}

export interface EditorApi {
  registerBlock<Model = any>(block: BlockRegistration<Model>): Disposable
  registerDecoration(dec: DecorationRegistration): Disposable
  onChange(handler: (e: EditorChangeEvent) => void): Disposable
  getActive(): Promise<ActiveEditorState | null>
  insert(payload: EditorInsertPayload): Promise<{ ok: boolean }>
}

// ---------------------------------------------------------------------------
// ctx.ai (§5.3)
// ---------------------------------------------------------------------------

export interface AICompleteOptions {
  system?: string
  prompt: string
  onToken?: (t: string) => void
  citations?: Array<{ id: string; text: string }>
}

export interface AIProviderRegistration {
  id: string
  label: string
  icon?: string
  retrievalMode?: 'tfidf' | 'hybrid'
  /** Mirrors the rag-engine backend signature. */
  generate: (
    system: string,
    prompt: string,
    onToken: (t: string) => void,
    onComplete: () => void,
    citations: any[]
  ) => void
  configure?: () => void
  friendlyError?: (msg: string) => string
}

export interface AIApi {
  complete(opts: AICompleteOptions): Promise<{ text: string }>
  embed(text: string | string[]): Promise<number[] | number[][]>
  registerProvider(provider: AIProviderRegistration): Disposable
}

// ---------------------------------------------------------------------------
// ctx.brain (ADDITIVE v1 — gated by the `tools` capability)
// ---------------------------------------------------------------------------

/**
 * A tool the Company Brain's agent loop can call. The host namespaces the tool
 * id under the plugin (`<pluginId>__<toolId>`) so two plugins never collide and
 * a plugin cannot shadow a built-in tool. `parameters` is a JSON-schema-ish hint
 * the Brain renders into its tool catalogue (never executed). The `handler`
 * receives the loop's parsed args and returns structured data the Brain treats as
 * UNTRUSTED external input (relayed as data, never as instructions). A handler
 * that does network egress MUST also declare a `net:<host>` capability and fetch
 * via `ctx.net.fetch`.
 */
export interface BrainToolRegistration {
  /** Unique within the plugin; ^[a-z][a-z0-9_]* after host namespacing. */
  id: string
  /** One-line, prompt-facing description of what the tool does. */
  description: string
  /** Advisory JSON-schema-ish param hints, e.g. { query: 'string', k: 'number?' }. */
  parameters?: Record<string, any>
  /** Runs in the sandbox; returns structured data (or { error }) for the Brain. */
  handler: (args: any) => any | Promise<any>
}

/** A snapshot entry returned by `ctx.brain.listTools()`. */
export interface ToolInfo {
  id: string
  description: string
  source: string
}

export interface BrainApi {
  /** Contribute a tool to the Company Brain's agent loop. Requires `tools`. */
  registerTool(descriptor: BrainToolRegistration): Disposable
  /** List the tools currently registered with the Brain (ids only). */
  listTools(): Promise<ToolInfo[]>
}

// ---------------------------------------------------------------------------
// ctx.auth (§5.4)
// ---------------------------------------------------------------------------

export interface AuthProfile {
  username: string
  displayName?: string
  publicKey?: string
}

export interface AuthContextArg {
  teamId: string
  username: string
  profile: AuthProfile | null
}

/** Either a credential source (password) or a key-at-rest restore. */
export type AuthResult =
  | { password: string }
  | { publicKey: string; privateKey: string }

export interface LoginMethodRegistration {
  id: string
  label: string
  isAvailable?: (teamId: string) => Promise<boolean>
  render?: (mountToken: number) => VDOM
  authenticate: (ctxArg: AuthContextArg) => Promise<AuthResult>
}

export interface AuthApi {
  registerLoginMethod(method: LoginMethodRegistration): Disposable
}

// ---------------------------------------------------------------------------
// ctx.teams (§5.5)
// ---------------------------------------------------------------------------

export interface TeamMember {
  username: string
  displayName?: string
  publicKey: string
}

export interface TeamOpenInfo {
  teamId: string
  teamName: string
  members: TeamMember[]
}

export interface TeamActionRegistration {
  id: string
  label: string
  icon?: string
  run: (teamId: string) => void | Promise<void>
}

export interface TeamsApi {
  onTeamOpen(handler: (t: TeamOpenInfo) => void): Disposable
  registerTeamAction(action: TeamActionRegistration): Disposable
  list(): Promise<Array<{ teamId: string; teamName: string }>>
}

// ---------------------------------------------------------------------------
// ctx.storage / ctx.fs / ctx.net (§5.6)
// ---------------------------------------------------------------------------

export interface StorageApi {
  get(key: string): Promise<any>
  set(key: string, value: any): Promise<{ ok: boolean }>
  delete(key: string): Promise<{ ok: boolean }>
  keys(): Promise<string[]>
}

export interface FsListEntry {
  name: string
  path: string
  dir: boolean
}

export interface FsApi {
  read(path: string): Promise<string>
  list(dir: string): Promise<FsListEntry[]>
  write(path: string, data: string): Promise<{ ok: boolean }>
}

export interface NetFetchInit {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  headers?: Record<string, string>
  body?: string
}

export interface NetFetchResponse {
  status: number
  headers: Record<string, string>
  body: string
}

export interface NetApi {
  fetch(url: string, init?: NetFetchInit): Promise<NetFetchResponse>
}

// ---------------------------------------------------------------------------
// ctx.ui (§5.6)
// ---------------------------------------------------------------------------

export interface PanelRegistration {
  id: string
  title: string
  location: 'right' | 'left' | 'bottom'
  render: (mountToken: number) => VDOM
  onEvent?: (e: { action: string; payload?: any }) => void
}

export interface SidebarSectionRegistration {
  id: string
  title: string
  order: number
  render: () => VDOM
  headerAction?: { icon: string; command: string }
}

export interface ViewRegistration {
  id: string
  title: string
  icon?: string
  render: (mountToken: number) => VDOM
}

export interface ViewHandle extends Disposable {
  show(): void
}

export interface NavItemRegistration {
  id: string
  label: string
  icon: string
  target: string
}

export interface ToolbarItemRegistration {
  id: string
  icon: string
  title: string
  run: (sel: { from: number; to: number; text: string }) => void
}

export interface StatusItemRegistration {
  id: string
  location?: 'footer' | 'header'
}

export interface StatusItemHandle extends Disposable {
  set(text: string | { html: string }): void
}

export interface SettingsSectionRegistration {
  id: string
  title: string
  render: (mountToken: number) => VDOM
}

export interface NotifyOptions {
  message: string
  kind?: 'info' | 'success' | 'warn' | 'error'
  timeout?: number
}

export interface ModalOptions {
  title: string
  body: VDOM
  buttons?: Array<{ id: string; label: string; primary?: boolean }>
}

export interface UIApi {
  panel(p: PanelRegistration): UpdatableDisposable
  sidebarSection(s: SidebarSectionRegistration): Disposable
  view(v: ViewRegistration): ViewHandle
  navItem(n: NavItemRegistration): Disposable
  toolbarItem(t: ToolbarItemRegistration): Disposable
  statusItem(st: StatusItemRegistration): StatusItemHandle
  settingsSection(se: SettingsSectionRegistration): UpdatableDisposable
  notify(n: NotifyOptions): void
  modal(m: ModalOptions): Promise<{ button: string }>
  clipboardWrite(text: string): Promise<{ ok: boolean }>
  clipboardRead(): Promise<string>
}

// ---------------------------------------------------------------------------
// ctx.events (§5.8)
// ---------------------------------------------------------------------------

export type LifecycleEvent =
  | 'note:open'
  | 'note:save'
  | 'note:change'
  | 'team:updated'
  | 'file:changed'

export interface EventsApi {
  on(event: 'note:open', handler: (p: { docId: string; path: string; title: string }) => void): Disposable
  on(event: 'note:save', handler: (p: { docId: string; path: string }) => void): Disposable
  on(event: 'note:change', handler: (p: { docId: string; text: string; changedRanges: Array<{ from: number; to: number }> }) => void): Disposable
  on(event: 'team:updated', handler: (p: { teamId: string; members: TeamMember[] }) => void): Disposable
  on(event: 'file:changed', handler: (p: { path: string; type: 'add' | 'change' | 'unlink' }) => void): Disposable
  on(event: LifecycleEvent, handler: (payload: any) => void): Disposable
}

// ---------------------------------------------------------------------------
// PluginContext (the `ctx` handed to activate)
// ---------------------------------------------------------------------------

export interface PluginContext {
  /** The plugin's own id (reverse-DNS). */
  readonly id: string
  /** The granted capabilities for this plugin. */
  readonly capabilities: Capability[]
  commands: CommandsApi
  editor: EditorApi
  ai: AIApi
  /** ADDITIVE v1: present only when the `tools` capability is granted. */
  brain: BrainApi
  auth: AuthApi
  teams: TeamsApi
  storage: StorageApi
  fs: FsApi
  net: NetApi
  ui: UIApi
  events: EventsApi
}

// ---------------------------------------------------------------------------
// Plugin entry shape
// ---------------------------------------------------------------------------

export interface PluginImpl {
  activate(ctx: PluginContext): void | Promise<void>
  deactivate?(): void | Promise<void>
}

export declare function definePlugin<T extends PluginImpl>(impl: T): T

export default definePlugin

// ---------------------------------------------------------------------------
// RPC envelopes (§4) — exported so tooling/tests can reference the wire shape.
// ---------------------------------------------------------------------------

export type RpcErrorCode =
  | 'CAPABILITY_DENIED'
  | 'BAD_PARAMS'
  | 'NOT_FOUND'
  | 'TIMEOUT'
  | 'INTERNAL'
  | 'UNSUPPORTED_METHOD'
  | 'QUARANTINED'
  | 'HOST_DISPOSED'

export interface RpcRequest {
  type: 'request'
  id: number
  method: string
  params: any
}

export interface RpcResponse {
  type: 'response'
  id: number
  result: any
}

export interface RpcError {
  type: 'error'
  id: number
  error: { code: RpcErrorCode; message: string; data?: any }
}

export interface RpcEvent {
  type: 'event'
  id: number
  method: string
  params: any
}

export type RpcMessage = RpcRequest | RpcResponse | RpcError | RpcEvent
