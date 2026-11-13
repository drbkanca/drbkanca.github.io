import fs from 'node:fs/promises';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import * as cheerio from 'cheerio';

const BASE='https://dergipark.org.tr';
const JOURNAL='journalata';
const OAI=`${BASE}/api/public/oai/${JOURNAL}/`;
const RSS=[`${BASE}/tr/pub/${JOURNAL}/rss/lastissue/en`,`${BASE}/tr/pub/${JOURNAL}/rss/lastissue/tr`];
const OUT=path.resolve('public/data/journalata.json');
const HEADERS={'User-Agent':'JournalATAIndependentSite/0.1 (public metadata synchronization)','Accept':'application/xml,text/xml,text/html,application/rss+xml;q=0.9,*/*;q=0.8'};
const parser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_',textNodeName:'#text',trimValues:true,parseTagValue:false});
const pageHints=[
 ['aim-and-scope',['Aim & Scope','Aims & Scope','Aims and Scope'],['Amaç ve Kapsam']],
 ['publication-fees',['Price Policy','Publication Fee Policy','Fee Policy'],['Ücret Politikası']],
 ['editorial-board',['Journal Boards','Editorial Board'],['Dergi Kurulları']],
 ['statistics',['Statistics'],['İstatistikler']],
 ['writing-rules',['Author Guidelines','Writing Rules'],['Yazım Kuralları']],
 ['publication-ethics',['Ethical Principles and Publication Policy','Publication Ethics'],['Etik İlkeler ve Yayın Politikası']],
 ['indexing',['Indexes','Indexing'],['Dizinler']],
 ['publication-process',['Publication Process'],['Yayın Süreci']],
 ['open-access-policy',['Open Access Policy'],['Açık Erişim Politikası']],
 ['editorial-policies',['Editorial Policies'],['Editoryal Politikalar']],
 ['editor-guidelines',['Editor Guidelines'],['Editör Rehberi']],
 ['reviewer-guidelines',['Reviewer Guidelines'],['Hakem Rehberi']],
 ['editorial-office',['Editorial Office'],['Editoryal Ofis']],
 ['contact',['Journal Contact','Contact'],['Dergi İletişim']],
 ['archive',['Archive'],['Arşiv']],
 ['archive-policy',['Archive Policy','Archiving Policy'],['Arşiv Politikası']],
 ['correction-retraction-policy',['Correction and Retraction Policy','Corrections and Retractions Policy','Correction & Retraction Policy'],['Düzeltme ve Geri Çekme Politikası']]
];
function text(v){if(v==null)return '';if(typeof v==='string')return v;if(typeof v==='number')return String(v);if(Array.isArray(v))return v.map(text).filter(Boolean).join('; ');if(typeof v==='object')return text(v['#text']??'');return '';}
function decodeHtml(s=''){return s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");}
async function get(url){const r=await fetch(url,{headers:HEADERS,redirect:'follow'});if(!r.ok)throw new Error(`${r.status} ${url}`);return await r.text();}
function findKey(obj,key){if(!obj||typeof obj!=='object')return undefined;for(const [k,v] of Object.entries(obj)){if(k.split(':').at(-1)===key)return v;const found=findKey(v,key);if(found!==undefined)return found;}return undefined;}
function values(value){return (Array.isArray(value)?value:[value]).map(text).filter(Boolean);}
function parseRecord(record){const meta=findKey(record,'metadata')||record;const titles=values(findKey(meta,'title'));const authors=values(findKey(meta,'creator'));const abstracts=values(findKey(meta,'description'));const allIds=values(findKey(meta,'identifier'));const dates=values(findKey(meta,'date'));const subjects=values(findKey(meta,'subject'));const source=text(findKey(meta,'source'));const relations=values(findKey(meta,'relation')).join(' ');const doi=allIds.find(x=>x.includes('doi.org/'))||'';const url=allIds.find(x=>x.includes('/article/'))||relations.match(/https?:\/\/[^\s]+article\/\d+/)?.[0]||'';return {title:titles.find(x=>!/[ğüşöçıİ]/i.test(x))||titles[0]||'',titleTr:titles.find(x=>/[ğüşöçıİ]/i.test(x))||titles[1]||'',authors:authors.join(', '),abstract:abstracts.find(x=>!/[ğüşöçıİ]/i.test(x))||abstracts[0]||'',abstractTr:abstracts.find(x=>/[ğüşöçıİ]/i.test(x))||abstracts[1]||'',date:dates[0]?.slice(0,10)||'',doi,url,keywords:subjects,source};}
async function readOai(){let url=`${OAI}?verb=ListRecords&metadataPrefix=oai_dc`;let all=[];let pages=0;while(url&&pages<100){pages++;const xml=await get(url);const doc=parser.parse(xml);const root=doc['OAI-PMH']||doc;const list=findKey(root,'ListRecords');if(!list)throw new Error('OAI ListRecords response not found');const records=list.record?(Array.isArray(list.record)?list.record:[list.record]):[];for(const rec of records){const h=findKey(rec,'header');if(text(findKey(h,'status'))==='deleted')continue;const a=parseRecord(rec);if(a.title||a.titleTr)all.push(a);}const token=text(findKey(list,'resumptionToken'));url=token?`${OAI}?verb=ListRecords&resumptionToken=${encodeURIComponent(token)}`:'';if(!records.length&&!token)break;}
const unique=new Map();for(const a of all){const key=a.url||a.doi||a.title; if(key)unique.set(key,a);}return [...unique.values()].sort((a,b)=>(b.date||'').localeCompare(a.date||''));}
async function readRss(){const items=[];for(const url of RSS){try{const xml=await get(url);const doc=parser.parse(xml);const channel=findKey(doc,'channel')||doc;const entries=findKey(channel,'item');for(const entry of (Array.isArray(entries)?entries:entries?[entries]:[])){const title=text(findKey(entry,'title'));const link=text(findKey(entry,'link'));const desc=text(findKey(entry,'description'));const creator=text(findKey(entry,'creator'))||text(findKey(entry,'author'));const date=text(findKey(entry,'pubDate'));items.push({title,url:link,abstract:desc.replace(/<[^>]*>/g,' ').trim(),authors:creator,date:date.slice(0,16)});}}catch(e){console.warn('RSS unavailable:',url,e.message);}}return items;}
async function discoverPages(locale='en'){const html=await get(`${BASE}/${locale}/pub/${JOURNAL}`);const $=cheerio.load(html);const found=[];for(const [slug,namesEn,namesTr] of pageHints){const names=locale==='tr'?namesTr:namesEn;let match=null;$('a[href]').each((_,el)=>{if(match)return;const label=$(el).text().replace(/\s+/g,' ').trim().toLocaleLowerCase(locale==='tr'?'tr':'en');if(names.some(n=>label===n.toLocaleLowerCase(locale==='tr'?'tr':'en'))){const href=$(el).attr('href');if(href)match=new URL(href,BASE).href;}});if(!match)continue;try{const raw=await get(match);const p=cheerio.load(raw);p('script,style,nav,header,footer,iframe,object,embed,form,button,input,textarea,select,svg,math,link,meta,base,.breadcrumb,.breadcrumbs,.sidebar,.menu').remove();let main=p('main').first();if(!main.length)main=p('#content').first();if(!main.length)main=p('.page-content').first();if(!main.length)main=p('body');main.find('*').each((_,el)=>{for(const [name,value] of Object.entries(el.attribs||{})){if(/^on/i.test(name)||name==='srcdoc'||name==='style'||name==='srcset'||name==='class'||name==='id'){p(el).removeAttr(name);continue;}if((name==='width'||name==='height')&&p(el).is('img')){p(el).removeAttr(name);continue;}if(name==='href'||name==='src'||name==='poster'){try{const resolved=new URL(value,match);if(!['http:','https:','mailto:','tel:'].includes(resolved.protocol)||(name!=='href'&&!['http:','https:'].includes(resolved.protocol)))p(el).removeAttr(name);else p(el).attr(name,resolved.href);}catch{p(el).removeAttr(name);}}}if(p(el).attr('target')==='_blank')p(el).attr('rel','noopener noreferrer');});const title=p('h1').first().text().trim()||names[0];const htmlContent=main.html()||'';found.push({slug,title,sourceUrl:match,html:htmlContent,text:main.text().replace(/\s+/g,' ').trim()});}catch(e){console.warn('Page unavailable:',match,e.message);}}
return found;}
async function readTimelineStats(){
  const html=await get(`${BASE}/en/pub/${JOURNAL}`);
  const $=cheerio.load(html);
  const pageText=$('body').text().replace(/\s+/g,' ').trim();
  const metrics=[
    ['firstDecision','Time to First Decision'],
    ['finalDecision','Time to Final Decision'],
    ['publication','Time to Publication']
  ];
  const stats={};
  for(const [key,label] of metrics){
    const at=pageText.toLowerCase().indexOf(label.toLowerCase());
    const match=at<0?null:pageText.slice(at+label.length,at+label.length+60).match(/^\s*[:：]?\s*(\d{1,3})\s*days?\b/i);
    if(!match)throw new Error(`Could not read DergiPark metric: ${label}`);
    stats[key]=Number(match[1]);
  }
  return stats;
}
async function readImpactVisibility(){
  const html=await get(`${BASE}/en/pub/${JOURNAL}`);
  const $=cheerio.load(html);
  const pageText=$('body').text().replace(/\s+/g,' ').trim();
  const readCount=(pattern,label)=>{
    const match=pageText.match(pattern);
    if(!match)throw new Error(`Could not read DergiPark impact metric: ${label}`);
    return match[1].replace(/\s+/g,'').replace(/,/g,'');
  };
  return {
    views:readCount(/Articles\s+View\s+Count\s*[:：]?\s*([\d.,]+\s*[KMB]?)/i,'Articles View Count'),
    downloads:readCount(/Articles\s+Download\s+Count\s*[:：]?\s*([\d.,]+\s*[KMB]?)/i,'Articles Download Count'),
    favorites:readCount(/Articles\s+Favorite\s+Count\s*[:：]?\s*([\d.,]+\s*[KMB]?)/i,'Articles Favorite Count')
  };
}
async function readAnnouncements(locale='en'){
  const html=await get(`${BASE}/${locale}/pub/${JOURNAL}`);
  const $=cheerio.load(html);
  const byId=new Map();
  $('a[href]').each((_,el)=>{
    const href=$(el).attr('href');
    if(!href)return;
    let resolved;try{resolved=new URL(href,BASE);}catch{return;}
    const match=resolved.pathname.match(/\/(?:en|tr)\/journalata\/announcements\/(\d+)\/?$/);
    if(!match||byId.has(match[1]))return;
    const title=$(el).text().replace(/\s+/g,' ').trim();
    if(!title||/^(read more|more|devamını oku)$/i.test(title))return;
    let card=$(el);
    for(let depth=0;depth<5;depth++){
      const parent=card.parent();
      if(!parent.length||parent.text().length>1200)break;
      card=parent;
    }
    const cardText=card.text().replace(/\s+/g,' ').trim();
    const date=cardText.match(/\b\d{1,2}[./]\d{1,2}[./]\d{4}\b|\b\d{1,2}\s+[A-Z][a-z]+\s+\d{4}\b/)?.[0]||'';
    byId.set(match[1],{id:match[1],title,url:resolved.href,date});
  });
  return [...byId.values()].slice(0,10);
}
let previous={};try{previous=JSON.parse(await fs.readFile(OUT,'utf8'));}catch{}
const result={updatedAt:new Date().toISOString(),articles:previous.articles||[],pages:previous.pages||[],stats:previous.stats||[],announcements:previous.announcements||[],sourceStatus:{}};
try{const timeline=await readTimelineStats();result.stats={...(previous.stats||{}),...timeline};result.sourceStatus.timeline='ok';}catch(e){result.stats={...(previous.stats||{})};result.sourceStatus.timeline=`error: ${e.message}`;console.warn('Timeline statistics sync failed:',e.message);}
try{const impact=await readImpactVisibility();result.stats={...(previous.stats||{}),impact};result.sourceStatus.impact='ok';}catch(e){console.warn('Impact/visibility sync failed:',e.message);result.stats={...(previous.stats||{}),impact:previous.stats?.impact||{views:'5K',downloads:'16K',favorites:'11'}};result.sourceStatus.impact=`error: ${e.message}`;}
try{const a=await readOai();if(a.length){result.articles=a;result.sourceStatus.oai=`ok:${a.length}`;}else result.sourceStatus.oai='empty: previous data retained';}catch(e){console.warn('OAI sync failed:',e.message);result.sourceStatus.oai=`error: ${e.message}`;}
try{const rss=await readRss();if(rss.length){result.latestRss=rss;result.sourceStatus.rss=`ok:${rss.length}`;}else result.sourceStatus.rss='empty';}catch(e){result.sourceStatus.rss=`error: ${e.message}`;}
try{const [announcements,announcementsTr]=await Promise.all([readAnnouncements('en'),readAnnouncements('tr')]);if(announcements.length){const trById=new Map(announcementsTr.map(item=>[item.id,item]));result.announcements=announcements.map(item=>{const tr=trById.get(item.id)||{};return {...item,titleTr:tr.title||'',dateTr:tr.date||item.date||''};});result.sourceStatus.announcements=`ok:${announcements.length}/${announcementsTr.length} (en/tr)`;}else result.sourceStatus.announcements='no announcements found: previous data retained';}catch(e){console.warn('Announcement sync failed:',e.message);result.sourceStatus.announcements=`error: ${e.message}`;}
try{const [pages,pagesTr]=await Promise.all([discoverPages('en'),discoverPages('tr')]);if(pages.length){const old=new Map((previous.pages||[]).map(p=>[p.slug,p]));const trBySlug=new Map(pagesTr.map(p=>[p.slug,p]));result.pages=pages.map(p=>{const prior=old.get(p.slug)||{};const tr=trBySlug.get(p.slug)||{};return {...p,titleTr:tr.title||prior.titleTr||'',htmlTr:tr.html||prior.htmlTr||'',textTr:tr.text||prior.textTr||''};});result.sourceStatus.pages=`ok:${pages.length}/${pagesTr.length} (en/tr)`;}else result.sourceStatus.pages='no English pages discovered: previous data retained';}catch(e){console.warn('Page sync failed:',e.message);result.sourceStatus.pages=`error: ${e.message}`;}
if(!Object.values(result.sourceStatus).some(status=>status.startsWith('ok:')))throw new Error('No DergiPark source returned usable data; previous dataset was left unchanged.');
await fs.mkdir(path.dirname(OUT),{recursive:true});await fs.writeFile(OUT,JSON.stringify(result,null,2));console.log('Journal ATA sync complete:',result.sourceStatus);
