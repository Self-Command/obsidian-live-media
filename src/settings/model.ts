// SPDX-License-Identifier: GPL-3.0-only
import fields from './schema.json';
export type Value = boolean | number | string | unknown[] | Record<string, unknown>;
export type Config = Record<string, Value>;
export interface Field {
  key: string; group: string; kind: string; default: Value; description: string; spec: string;
  min?: number; max?: number; integer?: boolean; options?: string[];
}
export const schema = fields as Field[];
export const schemaVersion = 1;
export type Platform = 'desktop' | 'android' | 'ios';
export interface Preferences {
  version: number; global: Config; platforms: Partial<Record<Platform, Config>>;
  photos: Record<string, Config>; presets: Record<string, Config>; previewed: string[];
}
export function defaults(platform: Platform = 'desktop'): Config {
  const config = Object.fromEntries(schema.map(f => [f.key, structuredClone(f.default)]));
  if (platform !== 'desktop') {
    config['performance.cacheMiB'] = 16;
    config['performance.maxInputMiB'] = 32;
    config['performance.maxPixelsMp'] = 16;
  }
  return config;
}
export function safePath(path: string, hidden = false): string {
  if (!path || path.length > 1024 || /[\u0000-\u001f:*?"<>|\\]/.test(path) || path.startsWith('/') ||
      path.split('/').some(p => !p || p === '.' || p === '..' || (!hidden && p.startsWith('.')))) throw new Error('Invalid vault path');
  if (/^\.obsidian(?:\/|$)|^\.trash(?:\/|$)/.test(path)) throw new Error('Protected vault directory');
  return path;
}
export function validateField(field: Field, value: unknown): Value {
  if (field.kind === 'boolean' && typeof value !== 'boolean') throw new Error('Expected boolean');
  if (field.kind === 'enum' && !field.options?.includes(String(value))) throw new Error('Invalid option');
  if (field.kind === 'number' || field.kind === 'mixed') {
    if (field.kind === 'mixed' && field.options?.includes(String(value))) return value as string;
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Expected finite number');
    if ((field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max) ||
      (field.integer && !Number.isInteger(value))) throw new Error('Number outside allowed range');
  }
  if (field.kind === 'text') {
    if (typeof value !== 'string' || value.length > 4096) throw new Error('Invalid text');
    if (field.key === 'badge.text' && (value.length < 1 || value.length > 12)) throw new Error('Badge text needs 1–12 characters');
    if (field.key === 'storage.copySuffix' && (!value || value.length > 24 || /[\u0000-\u001f\/:*?"<>|\\]/.test(value))) throw new Error('Unsafe suffix');
    if (field.key.endsWith('Directory') && value !== 'alongside') safePath(value, field.key !== 'storage.copyDirectory');
    if (field.key === 'badge.color' || field.key === 'badge.background') {
      if (!/^(theme|transparent|#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|(?:rgb|hsl)a?\([0-9.% ,/]+\))$/.test(value)) throw new Error('Use theme, transparent or a CSS color');
    }
    if (field.key === 'native.executable' && value && !/^(?:[a-zA-Z]:[\\/]|\/)/.test(value)) throw new Error('Native executable needs absolute path');
  }
  if (field.kind === 'json') {
    if (!value || typeof value !== 'object' || JSON.stringify(value).length > 65536) throw new Error('Invalid structured configuration');
    if (['detect.frontmatterFields','scope.includeFolders','scope.excludeFolders','scope.extensions'].includes(field.key)) {
      if (!Array.isArray(value) || value.some(v => typeof v !== 'string' || !v || v.length > 1024)) throw new Error('Expected string list');
      if (field.key.endsWith('Folders')) value.forEach(v => safePath(String(v)));
    }
    if (field.key === 'detect.rules') {
      if (!Array.isArray(value) || value.some(r => !r || typeof r !== 'object' ||
        !/^[\w-]{1,64}$/.test(String(r.id)) || !/^[\w-]{1,64}$/.test(String(r.language)) ||
        !['list','wikilinks','markdown','field'].includes(String(r.structure)) ||
        !['direct','candidate','dynamic'].includes(String(r.evidence)) || typeof r.enabled!=='boolean' ||
        r.structure==='field'&&!/^[\w.-]{1,64}$/.test(String(r.field)))) throw new Error('Invalid declarative rule');
    }
    if (field.key === 'pairing.explicit') {
      if (!Array.isArray(value) || value.some(r => !r || typeof r !== 'object' || typeof r.photo !== 'string' || typeof r.video !== 'string')) throw new Error('Pair needs photo and video paths');
      value.forEach(r => {safePath(r.photo); safePath(r.video);});
    }
    if(['compression.formats','detect.providers','compatibility.hostOverrides'].includes(field.key)){
      if(Array.isArray(value)||Object.keys(value).some(key=>!/^[\w-]{1,64}$/.test(key)))throw new Error('Expected named object');
      for(const [key,v]of Object.entries(value)){
        if(field.key==='compatibility.hostOverrides'){if(!['inherit','live','viewer','disabled'].includes(String(v)))throw new Error('Invalid host policy');}
        else if(typeof v!=='boolean')throw new Error('Expected boolean capability preference');
        if(field.key==='compression.formats'&&!['jpeg','png','webp','motion-jpeg','apple-pair'].includes(key))throw new Error('Format has no validated writer');
      }
    }
  }
  return structuredClone(value) as Value;
}
export function validatePatch(patch: unknown): Config {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Expected settings object');
  const clean: Config = {};
  for (const [key, value] of Object.entries(patch)) {
    const field = schema.find(f => f.key === key);
    if (!field) throw new Error('Unknown setting: ' + key);
    clean[key] = validateField(field, value);
  }
  return clean;
}
export function validateCombined(config: Config): void {
  if (Number(config['auto.exitRatio']) >= Number(config['auto.enterRatio'])) throw new Error('Exit ratio must be below entry ratio');
  if (config['host.clickPriority'] === 'viewer' && config['manual.gesture'] === 'click') throw new Error('Viewer priority requires an alternate playback gesture');
  if(Object.values(config['compatibility.hostOverrides'] as object).includes('viewer')&&config['manual.gesture']==='click')throw new Error('Per-host viewer priority also requires an alternate playback gesture');
  if (config['manual.gesture'] === 'modified-click' && config['host.clickPriority'] === 'live' &&
    config['gesture.modifier'] === config['host.passthroughModifier']) throw new Error('Playback and passthrough modifiers conflict');
  if (config['storage.backupDirectory'] === config['storage.reportDirectory'] || config['storage.copyDirectory'] === config['storage.backupDirectory']) throw new Error('Output and tool directories must differ');
}
const overrideForbidden = /^(?:native\.|storage\.|settings\.|detect\.|scope\.|diagnostics\.|network\.|pairing\.|compression\.(?:output|defaultScope|includeShared|repeated)$)/;
export class SettingsModel {
  data: Preferences;
  constructor(raw: unknown, public platform: Platform) {
    this.data = {version: schemaVersion, global: {}, platforms: {}, photos: {}, presets: {}, previewed: []};
    if (raw && typeof raw === 'object') {
      const r = raw as Partial<Preferences>;
      if (r.version && r.version > schemaVersion) throw new Error('Newer preferences version');
      this.data.global = validatePatch(r.global ?? {});
      for (const p of ['desktop','android','ios'] as Platform[]) if (r.platforms?.[p]) this.data.platforms[p] = validatePatch(r.platforms[p]);
      for (const [key, value] of Object.entries(r.photos ?? {})) this.data.photos[safePath(key)] = validatePatch(value);
      for (const [key, value] of Object.entries(r.presets ?? {})) this.data.presets[key] = validatePatch(value);
      this.data.previewed = (r.previewed ?? []).filter(v => typeof v === 'string').slice(-10000);
    }
    validateCombined(this.effective());
  }
  effective(photo?: string, note?: unknown, batch?: Config): Config {
    let config = {...defaults(this.platform), ...this.data.global};
    if (config['settings.syncPlatformProfiles']) config = {...config, ...this.data.platforms[this.platform]};
    const applyOverride = (p: unknown) => {
      try {const patch = validatePatch(p); for (const [k,v] of Object.entries(patch)) if (!overrideForbidden.test(k)) config[k] = v;} catch { /* invalid overrides cannot grant capabilities */ }
    };
    if (config['settings.overrideNotes'] && note) applyOverride(note);
    if (config['settings.overridePhotos'] && photo && this.data.photos[photo]) applyOverride(this.data.photos[photo]);
    if (batch) config = {...config, ...validatePatch(batch)};
    validateCombined(config);
    return config;
  }
  set(key: string, value: unknown): void {
    const patch = validatePatch({[key]: value});
    const next = {...this.data.global, ...patch};
    validateCombined({...defaults(this.platform), ...next});const previous=this.data.global;this.data.global=next;
    try{this.effective();}catch(error){this.data.global=previous;throw error;}
  }
  exportPublic(): string {
    const global = {...this.data.global}; delete global['native.executable']; global['native.enabled'] = false;
    delete global['pairing.explicit']; delete global['compatibility.hostOverrides'];
    return JSON.stringify({version: schemaVersion, global, platforms: {}, photos: {}, presets: {}}, null, 2);
  }
}
