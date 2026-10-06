import {describe,it,expect} from 'vitest';
import {schema,defaults,SettingsModel,validatePatch,validateCombined,safePath} from '../../src/settings/model';
import {sourceReferences,mergeReferences} from '../../src/references/source';
import {jpegSegments,boxes,concat} from '../../src/media/bytes';
import {probe} from '../../src/media/probe';
import {replaceMotionVideo} from '../../src/media/motion';
import {ByteCache} from '../../src/playback/cache';
const utf=(s:string)=>new TextEncoder().encode(s);
function box(type:string,payload:Uint8Array):Uint8Array{const b=new Uint8Array(8+payload.length);new DataView(b.buffer).setUint32(0,b.length);b.set(utf(type),4);b.set(payload,8);return b;}
const video=concat(box('ftyp',utf('isom0000')),box('moov',new Uint8Array()),box('mdat',utf('placeholder-container-not-a-decode-fixture')));
function jpeg(xmp:string,extra:Uint8Array=new Uint8Array()):Uint8Array{const text=utf('http://ns.adobe.com/xap/1.0/\0'+xmp),segment=new Uint8Array(4+text.length);segment.set([255,225]);new DataView(segment.buffer).setUint16(2,text.length+2);segment.set(text,4);return concat(Uint8Array.of(255,216),segment,Uint8Array.of(255,217),extra);}
describe('schema contract and override boundaries',()=>{
  it('contains exactly 113 unique validated default fields',()=>{
    expect(schema).toHaveLength(113);expect(new Set(schema.map(f=>f.key)).size).toBe(113);
    for(const platform of ['desktop','android','ios']as const){expect(()=>validatePatch(defaults(platform))).not.toThrow();expect(()=>validateCombined(defaults(platform))).not.toThrow();}
  });
  it.each([NaN,Infinity,-1,4])('rejects invalid auto concurrency %s',v=>expect(()=>validatePatch({'auto.concurrent':v})).toThrow());
  it.each(['../photos','/photos','a//b','.obsidian/x','a\\b','x:y'])('rejects unsafe output %s',v=>expect(()=>safePath(v)).toThrow());
  it('protects native execution, safety settings and invalid note overrides',()=>{
    const m=new SettingsModel({global:{'settings.overrideNotes':true},photos:{'p.jpg':{'native.enabled':true,'auto.mode':'off'}}},'desktop');
    const c=m.effective('p.jpg',{'native.enabled':true,'storage.backupDirectory':'override','badge.text':'PHOTO'});
    expect(c['native.enabled']).toBe(false);expect(c['storage.backupDirectory']).toBe('.live-media-backups');expect(c['badge.text']).toBe('PHOTO');expect(c['auto.mode']).toBe('off');
    expect(JSON.parse(m.exportPublic()).global['native.enabled']).toBe(false);
  });
  it('blocks gesture conflict and invalid inheritance before storing',()=>{
    const m=new SettingsModel({},'desktop');expect(()=>m.set('host.clickPriority','viewer')).toThrow();
    expect(()=>validateCombined({...defaults(),'auto.enterRatio':.1,'auto.exitRatio':.2})).toThrow();
  });
});
describe('reference evidence',()=>{
  const options={native:true,html:true,codeCandidates:true,rules:defaults()['detect.rules']as never,legacyLive:false};
  it('separates gallery, unknown code, native embeds, frontmatter and inline code',()=>{
    const source='---\ncover: ![[private.jpg]]\n---\n![[direct.jpg|400]]\n`![[code.jpg]]`\n```simple-gallery\n- ![[gallery.jpg]]\n- raw.jpg\n```\n```unknown\n![[candidate.jpg]]\n```\n<img src="html.png">';
    const r=sourceReferences(source,'note.md',options);
    expect(r.map(v=>[v.link,v.evidence])).toEqual([['direct.jpg','direct'],['gallery.jpg','direct'],['raw.jpg','direct'],['candidate.jpg','candidate'],['html.png','direct']]);
  });
  it('ignores unclosed fences as direct and supports declarative fields',()=>{
    expect(sourceReferences('```x\n![[candidate.jpg]]','n',options)[0]?.evidence).toBe('candidate');
    const r=sourceReferences('```custom\nimage: p.jpg\n```','n',{...options,rules:[{id:'custom',language:'custom',structure:'field',field:'image',evidence:'candidate',enabled:true}]});
    expect(r[0]?.link).toBe('p.jpg');
  });
  it('deduplicates identities without promoting unresolved media',()=>{
    const r=mergeReferences([{source:'n',path:'a.jpg',link:'a.jpg',evidence:'candidate',origin:'x',offset:0},{source:'n',path:'a.jpg',link:'a',evidence:'direct',origin:'y',offset:10}]);expect(r).toHaveLength(1);expect(r[0]?.evidence).toBe('direct');
  });
});
describe('bounded format parsing and XMP resource preservation',()=>{
  it('rejects malformed box sizes and truncation',()=>{expect(()=>boxes(Uint8Array.of(0,0,0,7,102,116,121,112))).toThrow();expect(()=>jpegSegments(Uint8Array.of(255,216,255,225,255,255))).toThrow();});
  it('changes only the semantic motion length, not gain-map length or cover time',()=>{
    const xml=`<rdf GCamera:MotionPhoto="1" GCamera:MotionPhotoPresentationTimestampUs="123456"><Container:Item Item:Semantic="GainMap" Item:Length="1234"/><Container:Item Item:Semantic="MotionPhoto" Item:Mime="video/mp4" Item:Length="${video.length}"/>       </rdf>`;
    const original=jpeg(xml,video);expect(probe(original).live).toBe(true);
    const newVideo=concat(box('ftyp',utf('isom0000')),box('moov',new Uint8Array()),box('mdat',utf('smaller')));
    const out=replaceMotionVideo(original,newVideo);expect(probe(out).timestamp).toBe('123456');expect(new TextDecoder().decode(out)).toContain('Item:Length="1234"');
    expect(probe(out).videoStart).toBe(probe(original).videoStart);
  });
  it('does not interpret a gain map length as a video offset',()=>{
    expect(probe(jpeg('<rdf GCamera:MotionPhoto="1"><Container:Item Item:Semantic="GainMap" Item:Length="12"/></rdf>',video)).capability).toBe('protected');
  });
  it('rejects unsafe XML and conflicting legacy offsets',()=>{
    expect(probe(jpeg('<!DOCTYPE foo><rdf GCamera:MicroVideo="1" GCamera:MicroVideoOffset="20"/>',video)).live).toBe(false);
  });
});
describe('byte cache ownership and budgets',()=>{
  it('keeps retained entries, evicts idle entries and releases explicitly',()=>{
    const c=new ByteCache(10,2);c.put('a',new Uint8Array(6));const release=c.retain('a');c.put('b',new Uint8Array(6));expect(c.get('a')).toBeDefined();expect(c.get('b')).toBeUndefined();release();c.invalidate('a');expect(c.bytes).toBe(0);
  });
});
