import {it,expect,vi} from 'vitest';
vi.mock('obsidian',()=>({TFile:class {constructor(public path:string,public extension='jpg'){}}}));
import {TFile,type App} from 'obsidian';
import {ReferenceIndex} from '../../src/references/vault';
import {defaults} from '../../src/settings/model';
function fixture(){
  const a=Object.assign(new TFile(),{path:'a/hero.jpg',extension:'jpg'}),b=Object.assign(new TFile(),{path:'b/hero.jpg',extension:'jpg'}),note=Object.assign(new TFile(),{path:'b/note.md',extension:'md'});
  const files=[a,b,note];const app={vault:{getFiles:()=>files,getResourcePath:(f:TFile)=>'app://resource/'+encodeURIComponent(f.path),cachedRead:async()=> '![[hero.jpg]]'},
    metadataCache:{getFileCache:()=>({}),getFirstLinkpathDest:(link:string,source:string)=>files.find(f=>f.path===link)||files.find(f=>f.path===source.slice(0,source.lastIndexOf('/')+1)+link)}}as unknown as App;
  return {files,a,b,note,index:new ReferenceIndex(app,defaults)};
}
it('resolves same basename relative to source and refuses remote basename guessing',async()=>{
  const {index,note}=fixture();expect((await index.note(note,new AbortController().signal))[0]?.path).toBe('b/hero.jpg');
  expect(index.rendered({currentSrc:'https://remote/hero.jpg'}as HTMLImageElement,note.path).evidence).toBe('unresolved');
});
it('maps rendered Vault resource identities and rebuilds the lookup after rename',()=>{
  const {index,b,note}=fixture();const image={currentSrc:'app://resource/b%2Fhero.jpg?mtime=1'}as HTMLImageElement;
  expect(index.rendered(image,note.path).path).toBe(b.path);b.path='b/renamed.jpg';index.invalidate();expect(index.rendered(image,note.path).path).toBeUndefined();
  expect(index.rendered({currentSrc:'app://resource/b%2Frenamed.jpg'}as HTMLImageElement,note.path).path).toBe(b.path);
});
it('isolates faulty providers, validates source and disposes registration',async()=>{
  const {index,note}=fixture(),dispose=vi.fn();const unregister=index.register({id:'bad',version:1,references:async()=>{throw new Error('Failed');},dispose});
  index.register({id:'good',version:1,references:async()=>[{source:note.path,link:'a/hero.jpg',evidence:'dynamic',origin:'plugin',offset:0},{source:'wrong.md',link:'b/hero.jpg',evidence:'direct',origin:'plugin',offset:0}]});
  const refs=await index.note(note,new AbortController().signal);expect(refs.map(r=>r.path)).toEqual(['b/hero.jpg','a/hero.jpg']);unregister();expect(dispose).toHaveBeenCalledOnce();index.destroy();
});
