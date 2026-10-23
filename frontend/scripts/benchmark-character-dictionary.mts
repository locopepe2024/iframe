/** Synthetic CPU benchmark, not a browser or production capacity claim.
 * From frontend: ./node_modules/.bin/vite-node --config vitest.config.mts scripts/benchmark-character-dictionary.mts
 * Duplicates built-in entries to isolate scale; excludes network, React rendering and memory.
 */
import { performance } from 'node:perf_hooks';
import { CHARACTER_DICTIONARY_PRESETS } from '../src/lib/characterDictionaryPresets';
import { CHARACTER_QUICK_PRESETS } from '../src/lib/characterQuickActions';
import { CHARACTER_DICTIONARY_GROUPS, dictionaryCategorySearch, localDictionaryCategories } from '../src/lib/characterDictionaryCategories';
const base = [...CHARACTER_DICTIONARY_PRESETS, ...CHARACTER_QUICK_PRESETS.filter(p => p.target !== 'route').map(p => ({id:p.id,title:p.label,text:p.value,search:p.searchText,type:'词条',categories:localDictionaryCategories(p.id)}))];
console.log(JSON.stringify({builtins:base.length,presets:CHARACTER_DICTIONARY_PRESETS.length,quick:CHARACTER_QUICK_PRESETS.length,groups:CHARACTER_DICTIONARY_GROUPS.length,categories:CHARACTER_DICTIONARY_GROUPS.reduce((n,g)=>n+g.children.length,0)}));
for (const size of [base.length,10000,50000]) {
 const entries=Array.from({length:size},(_,i)=>({...base[i%base.length],id:`sample-${i}`}));
 const groups=new Map(CHARACTER_DICTIONARY_GROUPS.map(g=>[g.id,new Set(g.children.map(([id])=>id))]));
 const inCategory=(e:typeof entries[number],key:string)=>e.categories.includes(key)||e.categories.some(c=>groups.get(key)?.has(c));
 const legacy=()=>{ let checksum=0; for(const g of CHARACTER_DICTIONARY_GROUPS) {checksum+=entries.filter(e=>e.type==='词条'&&inCategory(e,g.id)).length;for(const [key] of g.children) checksum+=entries.filter(e=>e.type==='词条'&&inCategory(e,key)).length;} return checksum;};
 const search=()=>entries.filter(e=>`${e.title} ${e.search} ${e.text} ${e.categories.map(dictionaryCategorySearch).join(' ')}`.toLocaleLowerCase().includes('圆脸')).length;
 const indexed=entries.map(e=>`${e.title} ${e.search} ${e.text} ${e.categories.map(dictionaryCategorySearch).join(' ')}`.toLocaleLowerCase());
 const indexSearch=()=>indexed.filter(s=>s.includes('圆脸')).length;
 const measure=(fn:()=>number)=>{fn();let a=[];let result=0;for(let i=0;i<15;i++){const start=performance.now();result=fn();a.push(performance.now()-start);}a.sort((a,b)=>a-b);return {median_ms:+a[7].toFixed(2),p95_ms:+a[14].toFixed(2),result};};
 console.log(JSON.stringify({size,classification_sweep:measure(legacy),rebuild_search_text:measure(search),precomputed_search_text:measure(indexSearch)}));
}
