// SPDX-License-Identifier: GPL-3.0-only
export const cameraNamespace='http://ns.google.com/photos/1.0/camera/';
export const itemNamespace='http://ns.google.com/photos/1.0/container/item/';
export interface XmlTag {name:string;attrs:Map<string,string>;start:number;end:number;closing:boolean}
export function xmpTags(xml:string):XmlTag[]{
  if(xml.length>65504||/<!DOCTYPE|<!ENTITY/i.test(xml))throw new Error('Unsafe/oversized XMP');
  const tags:XmlTag[]=[],stack:string[]=[];let p=0;
  while((p=xml.indexOf('<',p))>=0){
    if(xml.startsWith('<!--',p)){const end=xml.indexOf('-->',p+4);if(end<0)throw new Error('Unclosed XMP comment');p=end+3;continue;}
    if(xml.startsWith('<?',p)){const end=xml.indexOf('?>',p+2);if(end<0)throw new Error('Unclosed XMP instruction');p=end+2;continue;}
    let end=p+1,quote='';
    for(;end<xml.length;end++){const c=xml[end]!;if(quote){if(c===quote)quote='';}else if(c==='"'||c==="'")quote=c;else if(c==='>')break;}
    if(end>=xml.length||quote)throw new Error('Truncated XMP tag');
    const body=xml.slice(p+1,end),closing=body.startsWith('/'),self=body.endsWith('/');
    const name=body.replace(/^\//,'').match(/^[\w:.-]+/)?.[0];if(!name)throw new Error('Invalid XML tag');
    const attrs=new Map<string,string>();
    const rest=body.slice((closing?1:0)+name.length).replace(/\/$/,'');let consumed=0;
    const pattern=/\s+([\w:.-]+)\s*=\s*(["'])([^]*?)\2/g;let match:RegExpExecArray|null;
    while((match=pattern.exec(rest))){if(rest.slice(consumed,match.index).trim())throw new Error('Malformed XMP attribute');
      if(attrs.has(match[1]!))throw new Error('Duplicate XMP attribute');attrs.set(match[1]!,match[3]!);consumed=pattern.lastIndex;}
    if(rest.slice(consumed).trim())throw new Error('Malformed XMP attributes');
    if(closing){if(attrs.size||stack.pop()!==name)throw new Error('Unbalanced XMP');}
    else if(!self)stack.push(name);
    tags.push({name,attrs,start:p,end:end+1,closing});p=end+1;
    if(tags.length>2048)throw new Error('XMP tag budget exceeded');
  }
  if(stack.length)throw new Error('Unclosed XMP');return tags;
}
export function namespaces(tags:XmlTag[]):Map<string,string>{
  const result=new Map<string,string>();for(const tag of tags)for(const [key,value]of tag.attrs)if(key.startsWith('xmlns:')){
    const prefix=key.slice(6),old=result.get(prefix);if(old&&old!==value)throw new Error('Rebound XML namespace protected');result.set(prefix,value);}
  return result;
}
export function attr(tag:XmlTag,ns:Map<string,string>,uri:string,local:string):string|undefined {
  let value:string|undefined;for(const [key,current]of tag.attrs){const parts=key.split(':');
    if(parts.length===2&&parts[1]===local&&ns.get(parts[0]!)===uri){if(value!==undefined&&value!==current)throw new Error('Conflicting XMP property');value=current;}}
  return value;
}
