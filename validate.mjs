// asgracrypto: uji engine.mjs terhadap post Eliz. Jalan di browser dan Node (node validate.mjs [--baseline]).
// Engine hanya diberi data sampai detik post. Candle terakhir dibangun ulang dari data 15 menit agar tidak mengintip masa depan.
import {bj,analyze,fmt,FOMC_TS,FOMC_WIN,fomcSpans,fomcIn,withFomcTimes,wibTgl} from './engine.mjs';
export const VERSION='v5.4 (jurnal sinyal; tertutup dan terbuka dipisah, ada total; v4-v6 stop eksperimen; v7-v9 aturan FOMC eksperimen; default situs = v1)';
const M15=9e5,H1=36e5,DAY=864e5,T=s=>typeof s==='number'?s:Date.parse(s),pc=(a,b)=>(a/b-1)*100;
const mk=a=>({t:a[0],o:+a[1],h:+a[2],l:+a[3],c:+a[4],v:+a[5]});
const K=async(p,iv,q)=>(await bj(`klines?symbol=${p}&interval=${iv}&${q}`)).map(mk);
const pairOf=e=>e.pair||e.sym+'USDT';

async function part(p,last,ts){const k=(await K(p,'15m',`startTime=${last.t}&endTime=${ts}&limit=1000`)).filter(q=>q.t+M15<=ts);
 return k.length?{t:last.t,o:k[0].o,h:Math.max(...k.map(q=>q.h)),l:Math.min(...k.map(q=>q.l)),c:k.at(-1).c,v:k.reduce((s,q)=>s+q.v,0)}:{...last,h:last.o,l:last.o,c:last.o,v:0}}
async function snap(p,ts){const[d,f]=await Promise.all([K(p,'1d',`endTime=${ts}&limit=500`),K(p,'4h',`endTime=${ts}&limit=300`)]);
 if(!d.length||!f.length)throw new Error('tidak ada data '+p+' pada waktu itu');
 const[pd,pf]=await Promise.all([part(p,d.at(-1),ts),part(p,f.at(-1),ts)]);d[d.length-1]=pd;f[f.length-1]=pf;return{d,f}}
const bc=new Map();
const btcBias=ts=>{if(!bc.has(ts))bc.set(ts,snap('BTCUSDT',ts).then(({d,f})=>analyze('BTC',d,f,{qv:1e9}).bias).catch(()=>0));return bc.get(ts)};
// Satu snapshot data, dua varian dengan setup IDENTIK: v1 (stop tersentuh wick) dan v4 (stop baru berlaku bila candle penutup close melewati SL).
async function at(sym,p,ts){const{d,f}=await snap(p,ts),qv=d.at(-2).v*d.at(-2).c,bb=sym==='BTC'?0:await btcBias(ts);
 const c={btcBias:bb,qv,legacy:true,ts};return{d,R:{v1:analyze(sym,d,f,c),v4:analyze(sym,d,f,{...c,closeStop:true}),v5:analyze(sym,d,f,{...c,closeStop:true,hardR:2}),v6:analyze(sym,d,f,{...c,closeStop:true,hardR:3}),
  // Aturan FOMC (setup identik dengan v1 di luar jendela): v7 blokir entry, v8 blokir dan flat sebelum jendela, v9 stop 0,5R selama dan sesudah jendela.
  v7:analyze(sym,d,f,{...c,fomc:'blok'}),v8:analyze(sym,d,f,{...c,fomc:'flat'}),v9:analyze(sym,d,f,{...c,fomc:'ketat'})}}}
const pxAt=async(p,ts)=>{const k=await K(p,'15m',`endTime=${ts}&limit=3`);if(!k.length)throw new Error('tanpa data harga');return(k.filter(q=>q.t+M15<=ts).at(-1)||k.at(-1)).c};
const fwd=(p,ts,days)=>K(p,'1h',`startTime=${Math.ceil(ts/H1)*H1}&endTime=${ts+Math.min(40,days)*DAY}&limit=1000`);
async function pool(items,n,fn){const out=new Array(items.length);let i=0;await Promise.all(Array.from({length:n},async()=>{while(i<items.length){const k=i++;out[k]=await fn(items[k],k)}}));return out}

// Candle 1H penutup untuk timeframe tf (semua candle Binance selaras UTC). Epoch = Kamis 00:00, jadi close weekly = Minggu 23:00 UTC.
export const isClose=(q,tf)=>{const h=Math.floor(q.t/H1);return tf==='4H'?h%4===3:tf==='1W'?h%168===95:h%24===23};
// Simulasi plan engine pada candle 1H ke depan. Konservatif: stop dihitung lebih dulu bila satu candle menyentuh stop dan target.
// Aturan: entry limit, 70% ditutup di TP1 lalu stop pindah ke entry, 30% ke target akhir. Candle saat entry terisi hanya dicek stop-nya.
// Mode stop 'wick' (default): stop kena bila harga menyentuh SL, rugi tepat 1R. Mode 'close' (p.stopMode): stop hanya kena bila candle penutup p.stopTf
// close melewati SL, dan keluar di harga close itu, jadi rugi bisa lebih dari 1R. Target tetap sentuhan wick (order limit).
// Aturan FOMC (p.fomc, hanya diisi engine bila ctx.fomc): 'blok' = limit yang akan terisi di jendela dibatalkan; 'flat' = seperti blok, dan posisi terbuka ditutup di close candle
// 1H terakhir sebelum jendela mulai; 'ketat' = sejak candle pertama yang menyentuh jendela, stop (selama belum TP1) dipersempit ke 0,5R dan tetap begitu; bila harga sudah melewati stop baru,
// keluar di open candle itu (bukan di level stop). Hasil membawa t0 (candle isi) dan tx (waktu keluar) untuk menghitung keterpaparan jendela.
export function sim(p,fc){const L=p.side==1,CL=p.stopMode==='close',tg=p.tg.map(t=>t.v),t1=tg[0],tf=tg.at(-1),r1=Math.abs(t1-p.entry)/p.risk,rf=Math.abs(tf-p.entry)/p.risk,one=tg.length==1;
 const mode=p.fomc||null,FM=mode?fomcSpans():[],inW=t=>FM.some(([a,b])=>t+H1>a&&t<b),startsAt=t=>FM.some(([a])=>t+H1===a);
 const i0=fc.findIndex(q=>L?q.l<=p.entry:q.h>=p.entry);if(i0<0)return{st:'tidak terisi',R:0};
 if((mode==='blok'||mode==='flat')&&inW(fc[i0].t))return{st:'tidak terisi',R:0,blok:true};
 const t0=fc[i0].t,out=(st,R,i)=>({st,R,jam:i-i0,t0,tx:fc[i].t+H1}),
 hl=CL&&p.hardR?p.entry-p.side*p.hardR*p.risk:null; // batas rugi keras: sentuhan wick di -hardR kali R, keluar di level itu (atau di open bila gap)
 let stage=0,tight=false;
 for(let i=i0;i<fc.length;i++){const q=fc[i];
  if(mode==='ketat'&&!tight&&inW(q.t))tight=true;
  if(hl!=null&&(L?q.l<=hl:q.h>=hl)){const ex=L?Math.min(hl,q.o):Math.max(hl,q.o),Rx=p.side*(ex-p.entry)/p.risk;return stage?out('TP1 lalu stop di entry',.7*r1+.3*Rx,i):out('SL',Rx,i)}
  const tt=tight&&!stage,stop=stage?p.entry:tt?p.entry-p.side*.5*p.risk:p.sl,hs=CL?isClose(q,p.stopTf)&&(L?q.c<=stop:q.c>=stop):(L?q.l<=stop:q.h>=stop),
   x=CL?q.c:tt?(L?Math.min(stop,q.o):Math.max(stop,q.o)):stop,h1=L?q.h>=t1:q.l<=t1,hf=L?q.h>=tf:q.l<=tf;
  if(hs){const Rx=p.side*(x-p.entry)/p.risk;return stage?out('TP1 lalu stop di entry',.7*r1+.3*Rx,i):out('SL',Rx,i)}
  if(i!==i0){
   if(stage){if(hf)return out('target akhir',.7*r1+.3*rf,i)}
   else if(one){if(hf)return out('target',rf,i)}
   else if(h1){stage=1;if(hf)return out('target akhir',.7*r1+.3*rf,i)}}
  if(mode==='flat'&&startsAt(q.t)){const Rx=p.side*(q.c-p.entry)/p.risk;return stage?out('TP1 lalu keluar FOMC',.7*r1+.3*Rx,i):out('keluar FOMC',Rx,i)}}
 const o=p.side*(fc.at(-1).c-p.entry)/p.risk;return{st:'masih terbuka',R:stage?.7*r1+.3*o:o,jam:fc.length-i0,t0,tx:fc.at(-1).t+H1}}

function claim(c,e,r,d,fc,rts,ts){const dir=c.dir??e.dir??1,L=dir==1,base=c.base??(c.altBase?Math.min(...d.slice(-31,-1).map(q=>q.l)):r.px),
 by=T(c.by||(e.result&&e.result.ts)||ts)+H1;
 if(c.kind==='close'){ // klaim berbasis close (invalidasi atau konfirmasi): dir -1 = ada close di bawah level, dir 1 = ada close di atas level
  const o={text:c.text,info:!!c.info,conditional:true,base:r.px,level:c.level,ach:null},tf=(c.tf||'1D').toUpperCase(),hit=fc.find(q=>isClose(q,tf)&&(dir<0?q.c<c.level:q.c>c.level));
  return fc.length?{...o,verdict:hit?'terjadi':'tidak terjadi',at:hit?new Date(hit.t).toISOString():null}:{...o,verdict:'tanpa data',at:null}}
 const lvl=c.level??base*(1+dir*.9*c.pct/100),w=fc.filter(q=>q.t<=by),o={text:c.text,info:!!c.info,conditional:!!c.conditional,base,level:lvl};
 if(!fc.length)return{...o,ach:null,verdict:'tanpa data',at:null};
 const W=w.length?w:fc,ex=L?Math.max(...W.map(q=>q.h)):Math.min(...W.map(q=>q.l)),i=fc.findIndex(q=>L?q.h>=lvl:q.l<=lvl);
 return{...o,ach:+(dir*pc(ex,base)).toFixed(1),verdict:i<0?'tidak tercapai':fc[i].t<=by?'tercapai tepat waktu':'tercapai, tapi setelah klaim',at:i<0?null:new Date(fc[i].t).toISOString()}}

function engLevels(r){const o=[];for(const[n,fr]of[['4H',r.f4],['1D',r.f1]]){if(!fr)continue;o.push([fr.L,'low '+n],[fr.L+fr.bd,'atas demand '+n],[fr.M,'tengah '+n],[fr.H-fr.bd,'bawah supply '+n],[fr.H,'high '+n]);if(fr.mon)o.push([fr.mon.l,'Monday low'],[fr.mon.h,'Monday high'])}
 for(const s of r.setups)o.push([s.entry,'entry '+s.tf],[s.sl,'SL '+s.tf]);
 if(r.wk){for(const[n,z]of[['supply',r.wk.sup],['demand',r.wk.dem]])if(z)o.push([z.lo,'weekly '+n+' bawah'],[z.hi,'weekly '+n+' atas'],[z.m,'weekly '+n]);o.push([r.wk.H,'weekly high 52m'],[r.wk.L,'weekly low 52m'])}
 return o}
function lvCheck(e,r){const EL=engLevels(r),tol=Math.max(.012*r.px,r.f4?.A||0),W=[];
 for(const l of e.levels||[])if(!/^target/.test(l.role))W.push({v:l.v,lab:l.role});
 for(const z of e.zones||[])W.push({lo:z.lo,hi:z.hi,lab:z.role});
 let hit=0;const miss=[];
 for(const w of W){const pts=w.v!=null?[w.v]:[w.lo,w.hi,(w.lo+w.hi)/2];let b=null;
  for(const p of pts)for(const[v,n]of EL){const dd=Math.abs(v-p);if(!b||dd<b.dd)b={dd,n,v}}
  const inside=w.v==null&&EL.some(([v])=>v>=w.lo-tol&&v<=w.hi+tol);
  if(b&&(b.dd<=tol||inside))hit++;else miss.push(`${w.lab} ${w.v??w.lo+'-'+w.hi} (terdekat: ${b?b.n+' '+fmt(b.v):'-'})`)}
 return{hit,total:W.length,miss}}

const PM={dev:'sweep-reclaim',tap:'sweep-reclaim',dd:'sweep-reclaim',mon:'sweep-reclaim',bo:'breakout-retest',tlb:'trendline-break',wolf:'wolf',zone:'retest-zone'};
// Penilaian: setup "aktif" = entry dalam 0,5 persen dari harga. Order tunda jauh di ekstrem range bukan kontradiksi dengan Eliz yang menunggu ekstrem.
export function grade(e,r,lv){const b=r.best,fr=r.f4||r.f1,S=r.setups,act=!!(b&&b.dist<=.5),same=S.filter(s=>s.side===e.dir),pk=new Set(same.map(s=>PM[s.kind])),patOk=(e.pat||[]).some(p=>pk.has(p)),dirOk=!!(b&&b.side===e.dir);let v,n='';
 if(e.cls==='setup'){v=dirOk&&patOk?'sama':dirOk||same.length?'sebagian':act?'berlawanan':'tidak terdeteksi';
  n=dirOk?(patOk?'arah dan pola sama':'arah sama, pola beda'):same.length?'ada setup searah tapi bukan yang terbaik':act?'engine aktif di arah sebaliknya':b?'hanya ada order tunda berlawanan':'engine tidak melihat pemicu ('+r.st+')'}
 else if(e.cls==='bias'){const x=act?b.side:r.bias;v=x===e.dir?'sama':x===0?'sebagian':'beda';n=act?'setup aktif engine: '+(b.side>0?'long':'short'):'struktur harian engine: '+['turun','datar','naik'][r.bias+1]}
 else if(e.cls==='notrade'){v=act?'beda':b||fr.mid||fr.flat?'sama':'sebagian';n=act?'engine memberi setup aktif padahal Eliz diam':b?'engine hanya menyiapkan order tunda di ekstrem':fr.mid?'engine juga di tengah range':'engine diam, tetapi harga tidak di tengah range'}
 else if(e.cls==='scenario'){const q=lv.total?lv.hit/lv.total:0;v=q>=.6?'sama':q>0?'sebagian':'tidak terdeteksi';n='dinilai dari kecocokan level, bukan arah'}
 else v='dilewati';
 return{verdict:v,note:n,patOk,dirOk}}

const engSum=r=>{const b=r.best;return{bias:r.bias,st:r.st,n:r.setups.length,best:b&&{side:b.side,tf:b.tf,kind:b.kind,why:b.why,entry:b.entry,sl:b.sl,tp:b.tg.map(t=>t.v),rr:b.rr,type:b.type,cf:b.cf[1],dist:b.dist,w:b.w},
 lain:r.setups.slice(1).map(s=>`${s.side==1?'L':'S'} ${s.tf} ${s.kind}`),
 wk:r.wk&&{sup:r.wk.sup&&[r.wk.sup.lo,r.wk.sup.hi],dem:r.wk.dem&&[r.wk.dem.lo,r.wk.dem.hi]},
 frames:Object.fromEntries([['4h',r.f4],['1d',r.f1]].filter(a=>a[1]).map(([k,fr])=>[k,{H:fr.H,L:fr.L,pos:+fr.pos.toFixed(2),mid:fr.mid,flat:fr.flat,mon:fr.mon&&{h:fr.mon.h,l:fr.mon.l}}]))}};
const evalV=(e,r,fc,ts)=>{const b=r.best,o={engine:engSum(r)};
 if(['invest','context'].includes(e.cls))o.grade={verdict:'dilewati',note:'bukan setup trading'};
 else{o.levels=lvCheck(e,r);o.grade=grade(e,r,o.levels);if(b)o.sim=sim(b,fc.filter(q=>q.t<=ts+(e.horizonDays||7)*DAY))}
 return o};

async function runOne(e){let ts=T(e.ts);const p=pairOf(e),o={id:e.id,sym:e.sym,ts:e.ts,cls:e.cls,dir:e.dir,note:e.note||'',flags:e.flags||[]};
 try{
  // Jam post tidak diketahui tetapi tanggal chart dan harganya ada: cari candle 15m pada rentang probe yang close-nya paling dekat dengan harga di chart.
  if(e.probe&&e.pxShown){const k=await K(p,'15m',`startTime=${T(e.probe[0])}&endTime=${T(e.probe[1])}&limit=1000`);
   if(k.length){let b=k[0];for(const q of k)if(Math.abs(q.c-e.pxShown)<Math.abs(b.c-e.pxShown))b=q;ts=b.t+M15;o.tsEst=new Date(ts).toISOString();o.tsEstDiff=+pc(b.c,e.pxShown).toFixed(2)}}
  const{d,R}=await at(e.sym,p,ts),r=R.v1;o.px=r.px;
  if(e.pxShown){o.pxShown=e.pxShown;o.pxDiff=+pc(r.px,e.pxShown).toFixed(2);o.tsSuspect=Math.abs(o.pxDiff)>2}
  const res=e.result,rts=res?T(res.ts):null,days=Math.max(e.horizonDays||7,rts?(rts-ts)/DAY+1:0),fc=await fwd(p,ts,days);
  Object.assign(o,evalV(e,R.v1,fc,ts));
  const win=fc.filter(q=>q.t<=ts+(e.horizonDays||7)*DAY);for(const v of['v4','v5','v6','v7','v8','v9'])o[v]=R[v].best&&o.grade.verdict!=='dilewati'?{sim:sim(R[v].best,win)}:{};
  if(res){const pa=await pxAt(p,rts);o.result={ts:res.ts,pxShown:res.pxShown??null,pxActual:pa,actualMove:+pc(pa,r.px).toFixed(2)};
   if(res.pxShown){o.result.shownMove=e.pxShown?+pc(res.pxShown,e.pxShown).toFixed(2):null;o.result.pxDiff=+pc(pa,res.pxShown).toFixed(2);o.result.tsSuspect=Math.abs(o.result.pxDiff)>2;
    if(res.altTs)o.result.altDiff=+pc(await pxAt(p,T(res.altTs)),res.pxShown).toFixed(2)}}
  o.claims=(e.claims||[]).map(c=>claim(c,e,r,d,fc,rts,ts));
 }catch(x){o.error=String(x.message||x);o.optional=!!e.optional}
 return o}

export async function runDataset(ds,{onProgress,conc=3}={}){let n=0;return pool(ds.entries,conc,async e=>{const x=await runOne(e);onProgress&&onProgress(++n,ds.entries.length,e.id);return x})}

// Pembanding: jam acak (seed tetap) pada koin yang sama. v1 dan v4 memakai setup identik, jadi selisihnya murni dari aturan stop (berpasangan, tanpa derau setup).
export async function runBaseline(ds,{n=200,seed=7,from='2026-06-20',to='2026-09-28',days=7,conc=4,onProgress}={}){
 const syms=[...new Set(ds.entries.filter(e=>e.cls!=='invest'&&!e.pair&&!e.optional).map(e=>e.sym))];
 let s=seed;const rnd=()=>{s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296};
 const a=T(from),b=T(to),jobs=Array.from({length:n},()=>({sym:syms[Math.floor(rnd()*syms.length)],ts:Math.floor((a+rnd()*(b-a))/H1)*H1}));let k=0;
 return pool(jobs,conc,async j=>{const o={sym:j.sym,ts:new Date(j.ts).toISOString()};
  try{const p=j.sym+'USDT',{R}=await at(j.sym,p,j.ts),fc=R.v1.best?await fwd(p,j.ts,days):[];
   for(const v of['v1','v4','v5','v6','v7','v8','v9']){const x=R[v].best;o[v]=x?{sim:sim(x,fc),side:x.side,kind:x.kind,tf:x.tf}:{}}}catch(x){o.error=String(x.message||x)}
  onProgress&&onProgress(++k,n,j.sym);return o})}

// Sampel acak yang berdekatan (koin, sisi, pola, timeframe sama, selisih <=48 jam) biasanya trade yang sama dihitung berkali-kali.
// Karena itu perbandingan dihitung per KLASTER, dengan bootstrap (seed tetap) untuk selang kepercayaan 95 persen.
export function clusterDiff(bl,k,{iters=2000,seed=11,closed=false}={}){
 const P=bl.filter(x=>!x.error&&x.v1&&x.v1.sim&&x.v1.sim.st!=='tidak terisi'&&x[k]&&x[k].sim&&(!closed||(CLOSED.has(x.v1.sim.st)&&CLOSED.has(x[k].sim.st)))).map(x=>({key:x.sym+x.v1.side+x.v1.kind+x.v1.tf,t:Date.parse(x.ts),a:x.v1.sim.R,b:x[k].sim.R})).sort((p,q)=>p.key<q.key?-1:p.key>q.key?1:p.t-q.t);
 const C=[];let cur=[];for(const x of P){if(cur.length&&cur[0].key===x.key&&x.t-cur.at(-1).t<=48*H1)cur.push(x);else{if(cur.length)C.push(cur);cur=[x]}}if(cur.length)C.push(cur);
 const m=a=>a.reduce((s,v)=>s+v,0)/a.length,K=C.map(c=>({a:m(c.map(x=>x.a)),b:m(c.map(x=>x.b))})),d=K.map(x=>x.b-x.a);
 if(!K.length)return{trade:0,klaster:0};
 let s=seed;const rnd=()=>{s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296};
 const bs=[];for(let i=0;i<iters;i++){let z=0;for(let j=0;j<d.length;j++)z+=d[Math.floor(rnd()*d.length)];bs.push(z/d.length)}bs.sort((x,y)=>x-y);
 const r2=v=>+v.toFixed(2);
 return{trade:P.length,klaster:K.length,rataV1:r2(m(K.map(x=>x.a))),rataVar:r2(m(K.map(x=>x.b))),selisih:r2(m(d)),ci:[r2(bs[Math.floor(.025*iters)]),r2(bs[Math.floor(.975*iters)])],lebihBaik:d.filter(x=>x>1e-9).length,lebihBuruk:d.filter(x=>x<-1e-9).length}}
const pair=(ok,k)=>{const par=ok.filter(x=>x.v1&&x.v1.sim&&x.v1.sim.st!=='tidak terisi'&&x[k]&&x[k].sim),dif=par.filter(x=>Math.abs(x[k].sim.R-x.v1.sim.R)>1e-9),sum=a=>+a.reduce((s,v)=>s+v,0).toFixed(2);
 return{n:par.length,tertutupKeduanya:par.filter(x=>CLOSED.has(x.v1.sim.st)&&CLOSED.has(x[k].sim.st)).length,slJadiTerbuka:par.filter(x=>x.v1.sim.st==='SL'&&x[k].sim.st==='masih terbuka').length,beda:dif.length,lebihBaik:dif.filter(x=>x[k].sim.R>x.v1.sim.R).length,lebihBuruk:dif.filter(x=>x[k].sim.R<x.v1.sim.R).length,selisihR:sum(dif.map(x=>x[k].sim.R-x.v1.sim.R)),totalV1:sum(par.map(x=>x.v1.sim.R)),totalVar:sum(par.map(x=>x[k].sim.R))}};
export const bl2=bl=>{const ok=bl.filter(x=>!x.error),st=(L,k)=>simStats(L.map(x=>x[k]||{})),V=['v4','v5','v6'];
 return{n:bl.length,v1:st(bl,'v1'),v4:st(bl,'v4'),v5:st(bl,'v5'),v6:st(bl,'v6'),par:Object.fromEntries(V.map(k=>[k,pair(ok,k)])),kl:Object.fromEntries(V.map(k=>[k,clusterDiff(ok,k)])),klT:Object.fromEntries(V.map(k=>[k,clusterDiff(ok,k,{closed:true})])),err:bl.length-ok.length}};
// Trade TERTUTUP: SL, target, target akhir, atau TP1 lalu stop di entry. Trade "masih terbuka" belum terealisasi: R-nya hanya nilai pada harga terakhir
// di jendela uji, jadi dilaporkan terpisah dan TIDAK ikut rata-rata, median, atau jumlah menang. minR = kerugian terburuk di trade tertutup.
const CLOSED=new Set(['SL','target','target akhir','TP1 lalu stop di entry','keluar FOMC','TP1 lalu keluar FOMC']);
export const simStats=L=>{const S=L.filter(x=>x.sim),f=S.filter(x=>x.sim.st!=='tidak terisi'),C=f.filter(x=>CLOSED.has(x.sim.st)),O=f.filter(x=>x.sim.st==='masih terbuka'),
 R=a=>a.map(x=>x.sim.R).sort((p,q)=>p-q),avg=a=>a.length?+(a.reduce((t,v)=>t+v,0)/a.length).toFixed(2):null,rc=R(C),ro=R(O);
 return{n:L.length,setup:S.length,terisi:f.length,tertutup:C.length,terbuka:O.length,win:C.filter(x=>x.sim.R>0).length,sl:C.filter(x=>x.sim.st==='SL').length,
  avgR:avg(rc),medR:rc.length?+rc[Math.floor(rc.length/2)].toFixed(2):null,tanpaTerbaik:avg(rc.slice(0,-1)),minR:rc.length?+rc[0].toFixed(2):null,
  bukaR:avg(ro),bukaPos:O.filter(x=>x.sim.R>0).length,avgTotal:avg(R(f))}}; // avgTotal = rata-rata R semua trade terisi, posisi terbuka dinilai pada harga terakhir

const core=L=>{const g=L.filter(x=>x.grade.verdict!=='dilewati'),c=k=>g.filter(x=>x.grade.verdict===k).length,lv=L.filter(x=>x.levels&&x.levels.total);
 return{dinilai:g.length,sama:c('sama'),sebagian:c('sebagian'),beda:c('beda')+c('berlawanan')+c('tidak terdeteksi'),
  skor:g.length?Math.round(g.reduce((s,x)=>s+({sama:1,sebagian:.5}[x.grade.verdict]||0),0)/g.length*100):null,
  levelHit:lv.reduce((s,x)=>s+x.levels.hit,0),levelTotal:lv.reduce((s,x)=>s+x.levels.total,0),sim:simStats(L)}};
export function summarize(res){const ok=res.filter(x=>!x.error),cl=ok.flatMap(x=>(x.claims||[]).filter(y=>!y.info&&!y.conditional));
 return{entri:res.length,error:res.filter(x=>x.error&&!x.optional).length,...core(ok),v4:{sim:simStats(ok.map(x=>x.v4||{}))},v5:{sim:simStats(ok.map(x=>x.v5||{}))},v6:{sim:simStats(ok.map(x=>x.v6||{}))},v7:{sim:simStats(ok.map(x=>x.v7||{}))},v8:{sim:simStats(ok.map(x=>x.v8||{}))},v9:{sim:simStats(ok.map(x=>x.v9||{}))},
  klaimOk:cl.filter(y=>y.verdict==='tercapai tepat waktu').length,klaimTotal:cl.length,
  waktuMencurigakan:ok.filter(x=>x.tsSuspect||x.result?.tsSuspect).map(x=>x.id)}}

// ===== UJI ATURAN FOMC (v7 blokir, v8 flat, v9 stop 0,5R) terhadap v1 =====
// Desain: v7-v9 memakai setup IDENTIK dengan v1 dan hanya berbeda di dalam/di dekat jendela FOMC, jadi sampel acak biasa hampir seluruhnya tidak menguji apa pun. Karena itu sampel
// diambil hanya pada rentang yang bisa terpengaruh: dari (jendela mulai - days) sampai jendela selesai, n sampel per peristiwa FOMC. Unit independen = PERISTIWA FOMC, bukan sampel:
// sampel dalam satu peristiwa bergerak bersama pasar yang sama. Selang kepercayaan memakai bootstrap per peristiwa.
// KONTROL PLASEBO: memblokir trade hanya membuang trade, jadi v7 tampak membantu kapan pun rata-rata trade v1 negatif, terlepas dari FOMC. Karena itu aturan yang sama juga dijalankan
// pada tanggal plasebo (Kamis 01:00 WIB = Rabu 18:00 UTC, 14 hari sebelum dan sesudah tiap FOMC, tanpa tumpang tindih dengan jendela asli) dan efek di FOMC asli dibandingkan dengan efek di tanggal plasebo.
// KRITERIA KEPUTUSAN (ditetapkan sebelum melihat hasil, jangan diubah sesudahnya): sebuah aturan hanya dianggap membantu bila (1) selang 95% selisih rata-rata R per peristiwa seluruhnya > 0,
// (2) ada >= 6 peristiwa, (3) efeknya lebih besar daripada efek di tanggal plasebo (p < 0,05), dan (4) hasil yang sama muncul di dua seed berbeda. Selain itu: belum terbukti, v1 tetap default.
const prng=s=>()=>{s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296};
export async function runBaselineFomc(ds,{n=40,seed=21,from='2026-01-01',days=7,conc=4,now=Date.now(),placebo=0,onProgress}={}){
 if(placebo)return(await withFomcTimes(FOMC_TS.map(t=>t+placebo*DAY),()=>runBaselineFomc(ds,{n,seed,from,days,conc,now,placebo:0,onProgress}))).map(r=>({...r,ev:r.ev+(placebo>0?100:200),pl:placebo})); // ID peristiwa plasebo dibedakan dari FOMC asli dan antar arah geser
 const syms=[...new Set(ds.entries.filter(e=>e.cls!=='invest'&&!e.pair&&!e.optional).map(e=>e.sym))],rnd=prng(seed),
  evs=FOMC_TS.map((t,i)=>({t,i})).filter(e=>e.t>=T(from)&&e.t+FOMC_WIN.post+days*DAY<=now),jobs=[];
 for(const ev of evs)for(let k=0;k<n;k++){const a=ev.t-FOMC_WIN.pre-days*DAY,b=ev.t+FOMC_WIN.post;jobs.push({ev:ev.i,sym:syms[Math.floor(rnd()*syms.length)],ts:Math.floor((a+rnd()*(b-a))/H1)*H1})}
 let k=0;
 return pool(jobs,conc,async j=>{const o={sym:j.sym,ts:new Date(j.ts).toISOString(),ev:j.ev,inW:fomcIn(j.ts)>=0};
  try{const p=j.sym+'USDT',{R}=await at(j.sym,p,j.ts),fc=(R.v1.best||R.v9.best)?await fwd(p,j.ts,days):[];
   for(const v of['v1','v7','v8','v9']){const x=R[v].best;o[v]=x?{sim:sim(x,fc),side:x.side,kind:x.kind,tf:x.tf,entry:x.entry}:{}}}catch(x){o.error=String(x.message||x)}
  onProgress&&onProgress(++k,jobs.length,j.sym);return o})}
const mean=a=>a.reduce((s,v)=>s+v,0)/a.length,r2=v=>v==null?null:+v.toFixed(2),med=a=>{if(!a.length)return null;const b=[...a].sort((x,y)=>x-y),m=b.length>>1;return r2(b.length%2?b[m]:(b[m-1]+b[m])/2)};
const evDiffs=(base,k)=>{const D=base.map(x=>{const y=x[k],has=!!(y&&y.sim),b=has?y.sim.R:0;return{ev:x.ev,a:x.v1.sim.R,b,d:b-x.v1.sim.R,blok:!has||!!y.sim.blok||y.sim.st==='tidak terisi'}}),by=new Map();
 for(const z of D){if(!by.has(z.ev))by.set(z.ev,[]);by.get(z.ev).push(z)}
 return{D,E:[...by].map(([ev,L])=>({ev,n:L.length,blok:L.filter(z=>z.blok).length,v1:mean(L.map(z=>z.a)),var:mean(L.map(z=>z.b)),selisih:mean(L.map(z=>z.d))})).sort((p,q)=>p.ev-q.ev)}};
const baseOf=rows=>rows.filter(x=>!x.error&&x.v1&&x.v1.sim&&x.v1.sim.st!=='tidak terisi');
// plasebo: gabungan hasil runBaselineFomc(...,{placebo:-14}) dan {placebo:14}; ID peristiwanya sudah dibedakan oleh runBaselineFomc.
export function fomcReport(rows,{iters=4000,seed=31,plasebo=null}={}){
 const ok=rows.filter(x=>!x.error),base=baseOf(rows),SP=fomcSpans(),rnd=prng(seed);
 const expo=r=>r.t0!=null&&SP.some(([a,b])=>r.t0<b&&r.tx>a),ex=base.filter(x=>expo(x.v1.sim)),nx=base.filter(x=>!expo(x.v1.sim)),R=L=>L.map(x=>x.v1.sim.R);
 const out={sampel:rows.length,error:rows.length-ok.length,v1Terisi:base.length,peristiwa:[...new Set(base.map(x=>x.ev))].length,
  v1Terpapar:{n:ex.length,avgR:ex.length?r2(mean(R(ex))):null,medR:med(R(ex))},v1TidakTerpapar:{n:nx.length,avgR:nx.length?r2(mean(R(nx))):null,medR:med(R(nx))},
  setupBeda:0,aturan:{}}; // setupBeda: cek integritas, harus 0 (varian dan v1 memakai setup identik bila varian tidak diblokir di analisis)
 for(const x of ok)for(const k of['v7','v8','v9'])if(x[k]&&x[k].entry!=null&&x.v1&&x.v1.entry!=null&&(x[k].entry!==x.v1.entry||x[k].side!==x.v1.side))out.setupBeda++;
 const pb=plasebo&&plasebo.length?baseOf(plasebo):null;
 for(const k of['v7','v8','v9']){
  const{D,E}=evDiffs(base,k);let ci=null;
  if(E.length>=2){const bs=[];for(let i=0;i<iters;i++){let z=0;for(let j=0;j<E.length;j++)z+=E[Math.floor(rnd()*E.length)].selisih;bs.push(z/E.length)}bs.sort((p,q)=>p-q);ci=[r2(bs[Math.floor(.025*iters)]),r2(bs[Math.floor(.975*iters)])]}
  const sel=E.length?mean(E.map(e=>e.selisih)):null;let pl=null;
  if(pb&&pb.length&&E.length){const PE=evDiffs(pb,k).E;if(PE.length){let c=0;for(let i=0;i<iters;i++){let z=0;for(let j=0;j<E.length;j++)z+=PE[Math.floor(rnd()*PE.length)].selisih;if(z/E.length>=sel)c++}
   pl={peristiwa:PE.length,sampel:pb.length,selisihRata:r2(mean(PE.map(e=>e.selisih))),min:r2(Math.min(...PE.map(e=>e.selisih))),maks:r2(Math.max(...PE.map(e=>e.selisih))),p:+((c+1)/(iters+1)).toFixed(3)}}}
  const pos=ci&&ci[0]>0;
  out.aturan[k]={n:D.length,diblokir:D.filter(z=>z.blok).length,berubah:D.filter(z=>Math.abs(z.d)>1e-9).length,lebihBaik:D.filter(z=>z.d>1e-9).length,lebihBuruk:D.filter(z=>z.d<-1e-9).length,
   totalV1:r2(D.reduce((s,z)=>s+z.a,0)),totalVar:r2(D.reduce((s,z)=>s+z.b,0)),selisihRataPerPeristiwa:r2(sel),ci95:ci,peristiwaLebihBaik:E.filter(e=>e.selisih>1e-9).length,peristiwaLebihBuruk:E.filter(e=>e.selisih<-1e-9).length,
   plasebo:pl,perPeristiwa:E.map(e=>({ev:e.ev,tanggal:wibTgl(FOMC_TS[e.ev]),n:e.n,blok:e.blok,v1:r2(e.v1),var:r2(e.var),selisih:r2(e.selisih)})),
   putusan:E.length<6?'belum bisa dinilai: peristiwa < 6':ci&&ci[1]<0?'merugikan: selang 95% < 0':!pos?'belum terbukti: selang 95% mencakup 0':!pl?'selang 95% > 0, tetapi tanpa kontrol plasebo belum bisa dipercaya':pl.p<.05?'melewati kriteria 1-3; ulangi di seed lain (kriteria 4)':'selisih positif, tetapi tidak terbukti lebih besar dari tanggal plasebo (p >= 0,05): belum bisa disebut efek khusus FOMC'}}
 return out}

// ===== JURNAL SINYAL: UJI MAJU DENGAN DATA ASLI =====
// Backtest hanya bisa menilai masa lalu yang sudah kita lihat, jadi parameternya mudah tanpa sengaja disesuaikan dengan hasil. Uji maju tidak punya masalah itu: sinyal dicatat SEKARANG
// (entry, SL, target, versi engine, waktu), lalu dinilai nanti dengan candle 1H asli sesudah waktu pencatatan. Hanya candle yang sudah selesai yang dipakai (candle berjalan dibuang).
// Plan yang dinilai persis plan yang dicatat, memakai sim() yang sama dengan uji lain, jadi hasilnya sebanding.
export const mkSignal=(r,now=Date.now())=>{const s=r&&r.best;if(!s)return null;
 return{id:`${r.s}-${now}`,sym:r.s,ts:now,px:r.px,ver:'v1',diJendelaFomc:fomcIn(now)>=0,
  plan:{side:s.side,tf:s.tf,type:s.type,kind:s.kind,why:s.why,entry:s.entry,sl:s.sl,risk:s.risk,slp:s.slp,rr:s.rr,tg:s.tg.map(t=>({v:t.v,l:t.l})),w:s.w}}};
export async function resolveSignal(g,{days=14,now=Date.now()}={}){
 const d=Math.min(40,days),end=Math.min(now,g.ts+d*DAY),fc=(await K(g.sym+'USDT','1h',`startTime=${Math.ceil(g.ts/H1)*H1}&endTime=${end}&limit=1000`)).filter(q=>q.t+H1<=now),r=sim(g.plan,fc);
 return{...r,dinilai:now,candle:fc.length,final:CLOSED.has(r.st)||now>=g.ts+d*DAY}}
export const jurnalStats=a=>simStats(a.filter(g=>g.hasil).map(g=>({sim:g.hasil})));

if(typeof process!=='undefined'&&process.versions?.node&&/validate\.mjs$/.test(process.argv[1]||''))(async()=>{
 const fs=await import('node:fs/promises'),ds=JSON.parse(await fs.readFile(new URL('./eliz-dataset.json',import.meta.url),'utf8'));
 const arg=(k,d)=>{const a=process.argv.find(x=>x.startsWith('--'+k+'='));return a?a.split('=')[1]:d};
 if(process.argv.includes('--fomc')){const o={n:+arg('n',40),seed:+arg('seed',21),from:arg('from','2026-01-01')},pr=(t)=>(i,n,s)=>process.stderr.write(`\r${t} ${i}/${n} ${s}      `),
   rows=await runBaselineFomc(ds,{...o,onProgress:pr('fomc')}),pl=process.argv.includes('--tanpa-plasebo')?[]:[...await runBaselineFomc(ds,{...o,n:Math.ceil(o.n/2),seed:o.seed+1,placebo:-14,onProgress:pr('plasebo-14')}),...await runBaselineFomc(ds,{...o,n:Math.ceil(o.n/2),seed:o.seed+2,placebo:14,onProgress:pr('plasebo+14')})],
   rep=fomcReport(rows,{plasebo:pl});
  console.log('\n'+JSON.stringify(rep,null,1));await fs.writeFile('hasil-fomc.json',JSON.stringify({rows,plasebo:pl,rep},null,1));console.log('Tersimpan: hasil-fomc.json');return}
 const res=await runDataset(ds,{onProgress:(i,n,id)=>process.stderr.write(`\r${i}/${n} ${id}        `)});
 console.log('\n'+res.map(x=>`${x.id.padEnd(15)}${x.cls.padEnd(10)}${(x.error?'ERROR '+x.error:x.grade.verdict).padEnd(20)}wick:${(x.sim?x.sim.st+' '+x.sim.R.toFixed(2):'-').padEnd(24)}close:${x.v4&&x.v4.sim?x.v4.sim.st+' '+x.v4.sim.R.toFixed(2):'-'}`).join('\n'));
 const sum=summarize(res);console.log(JSON.stringify(sum,null,1));let bl=null;
 if(process.argv.includes('--baseline')){bl=await runBaseline(ds,{onProgress:(i,n)=>process.stderr.write(`\rbaseline ${i}/${n}   `)});console.log('\nbaseline acak',JSON.stringify(bl2(bl),null,1))}
 await fs.writeFile('hasil-uji.json',JSON.stringify({res,summary:sum,baseline:bl},null,1));console.log('Tersimpan: hasil-uji.json')})();
