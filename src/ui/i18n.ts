import type {Config} from '../settings/model';
export function language(config:Config):'zh'|'en'{
  const selected=config['settings.language'];if(selected==='zh'||selected==='en')return selected;
  return /^zh\b/i.test(navigator.language)?'zh':'en';
}
export function translate(config:Config,zh:string,en:string):string{return language(config)==='zh'?zh:en;}
export function fieldName(key:string):string{return key.replace('.',': ').replace(/([a-z])([A-Z])/g,'$1 $2');}
