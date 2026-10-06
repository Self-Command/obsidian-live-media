// SPDX-License-Identifier: GPL-3.0-only
export type Evidence = 'direct' | 'dynamic' | 'candidate' | 'unresolved';
export interface Reference {link: string; source: string; evidence: Evidence; origin: string; offset: number; path?: string; reason?: string}
export interface Rule {id: string; language: string; structure: 'list'|'wikilinks'|'markdown'|'field'; evidence: Evidence; enabled: boolean; field?: string}
export interface ReferenceProvider {
  id: string; version: 1;
  references(source: string, signal: AbortSignal): Promise<Reference[]>;
  dispose?(): void;
}
function standard(s: string, source: string, base: number, evidence: Evidence, origin: string): Reference[] {
  const result: Reference[]=[];
  const add=(link: string,offset: number)=>result.push({link,source,evidence,origin,offset:base+offset});
  for(const m of s.matchAll(/!\[\[([^\]\r\n]+)\]\]/g))add(m[1]!.split('|')[0]!.split('#')[0]!.trim(),m.index);
  for(const m of s.matchAll(/!\[[^\]\r\n]*\]\(\s*(<[^>\r\n]+>|[^\s)]+)(?:\s+["'][^"']*["'])?\s*\)/g))add(m[1]!.replace(/^<|>$/g,''),m.index);
  return result;
}
export function sourceReferences(body: string, source: string, options: {native: boolean; html: boolean; codeCandidates: boolean; rules: Rule[]; legacyLive: boolean}): Reference[] {
  // Mask before reading fences as well: a commented-out gallery is not a live reference.
  body=body.replace(/<!--[^]*?-->/g,m=>' '.repeat(m.length)).replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/,m=>' '.repeat(m.length));
  const result: Reference[]=[];let plain='';let position=0;
  const fence=/^ {0,3}(`{3,}|~{3,})([^\r\n]*)\r?\n/gm;
  let m: RegExpExecArray | null;
  while((m=fence.exec(body))){
    plain+=body.slice(position,m.index);const open=m[1]!,language=m[2]!.trim().split(/\s/)[0]??'';
    const start=fence.lastIndex;
    const close=new RegExp('^ {0,3}'+(open[0]==='`'?'`':'~')+'{'+open.length+',}\\s*$','gm');close.lastIndex=start;
    const ending=close.exec(body);const end=ending?.index??body.length;
    const code=body.slice(start,end);const rules=options.rules.filter(r=>r.enabled&&r.language===language);
    if(options.legacyLive&&language==='live')result.push(...standard(code,source,start,'direct','legacy-live'));
    if(rules.length){for(const rule of rules){
      if(rule.structure==='list'){
        let off=start;
        for(const line of code.split('\n')){
          const item=line.match(/^\s*-\s+(.+?)\s*$/);
          if(item){const found=standard(item[1]!,source,off,rule.evidence,rule.id);result.push(...found);
            if(!found.length){const wiki=item[1]!.match(/^\[\[([^\]]+)\]\]$/);if(wiki)result.push({link:wiki[1]!.split('|')[0]!,source,evidence:rule.evidence,origin:rule.id,offset:off});
              else if(!/^!|^\[|^#/.test(item[1]!))result.push({link:item[1]!,source,evidence:rule.evidence,origin:rule.id,offset:off});}}
          off+=line.length+1;
        }
      } else if(rule.structure==='field'){
        let off=start;for(const line of code.split('\n')){const colon=line.indexOf(':');
          if(colon>=0&&line.slice(0,colon).trim()===rule.field)result.push({link:line.slice(colon+1).trim(),source,evidence:rule.evidence,origin:rule.id,offset:off});off+=line.length+1;}
      } else if(rule.structure==='wikilinks'){
        for(const m of code.matchAll(/\[\[([^\]\r\n]+)\]\]/g))result.push({link:m[1]!.split('|')[0]!.split('#')[0]!.trim(),source,evidence:rule.evidence,origin:rule.id,offset:start+m.index});
      } else result.push(...standard(code,source,start,rule.evidence,rule.id));
    }}else if(options.codeCandidates)result.push(...standard(code,source,start,'candidate','unknown-code'));
    const next=ending?close.lastIndex:body.length;
    plain+=' '.repeat(next-m.index);position=next;fence.lastIndex=next;
  }
  plain+=body.slice(position);
  // Inline code, frontmatter and comments do not create direct references.
  plain=plain.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/,m=>' '.repeat(m.length))
    .replace(/<!--[^]*?-->/g,m=>' '.repeat(m.length)).replace(/(`+)[^`\r\n]*?\1/g,m=>' '.repeat(m.length));
  if(options.native)result.push(...standard(plain,source,0,'direct','markdown'));
  if(options.html)for(const image of plain.matchAll(/<(?:img|source)\s[^>]+>/gi)){
    for(const attr of image[0].matchAll(/\b(src|srcset)\s*=\s*["']([^"']+)["']/gi)){
      const links=attr[1]!.toLowerCase()==='srcset'?attr[2]!.split(',').map(v=>v.trim().split(/\s+/)[0]!):[attr[2]!];
      for(const link of links)result.push({link,source,evidence:'direct',origin:'html',offset:image.index});
    }
  }
  return result.sort((a,b)=>a.offset-b.offset);
}
export function mergeReferences(refs: Reference[]): Reference[] {
  const rank:Record<Evidence,number>={direct:4,dynamic:3,candidate:2,unresolved:1};
  const map=new Map<string,Reference>();
  for(const ref of refs){const key=ref.source+'\0'+(ref.path??ref.link);const old=map.get(key);
    if(!old||rank[ref.evidence]>rank[old.evidence])map.set(key,ref);}
  return [...map.values()];
}
