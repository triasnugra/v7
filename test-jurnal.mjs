import './test-mock.mjs';import fs from 'node:fs';
import {analyze,wib,FOMC_TS,fomcIn} from './engine.mjs';
import {mkSignal,resolveSignal,jurnalStats,sim} from './validate.mjs';
let fails=0;const ok=(n,c,x='')=>{if(!c)fails++;console.log(c?'OK  ':'GAGAL',n,x)};
// data palsu langsung dari fetch palsu
const get=async(s,iv,q)=>(await(await fetch(`https://x/api/v3/klines?symbol=${s}&interval=${iv}&${q}`)).json()).map(a=>({t:a[0],o:+a[1],h:+a[2],l:+a[3],c:+a[4],v:+a[5]}));
const syms=['SOLUSDT','ETHUSDT','BTCUSDT','FETUSDT','LTCUSDT','SUIUSDT','ALICEUSDT','NEARUSDT'];let n=0,beda=0,tested=0,belumFinal=0;
const T0=Date.parse('2026-06-01T00:00:00Z');
for(const sy of syms)for(let k=0;k<12;k++){const ts=T0+k*9*864e5+3*36e5,sym=sy.slice(0,-4);
 const d=await get(sy,'1d',`endTime=${ts}&limit=500`),f=await get(sy,'4h',`endTime=${ts}&limit=300`);
 // buang candle berjalan seperti pemindai live: pakai data sampai ts (mock mengembalikan candle yang dibuka <= ts, jadi yang terakhir parsial)
 let r;try{r=analyze(sym,d,f,{legacy:true,qv:1e9,btcBias:0,ts})}catch(e){continue}
 const g=mkSignal(r,ts);if(!g)continue;n++;
 // 'now' jauh setelah horizon: hasil harus sama dengan sim langsung pada candle 1H yang sama
 const now=ts+30*864e5,res=await resolveSignal(g,{days:14,now}),fc=(await get(sy,'1h',`startTime=${Math.ceil(ts/36e5)*36e5}&endTime=${ts+14*864e5}&limit=1000`)),ref=sim(r.best,fc);
 tested++;if(Math.abs(res.R-ref.R)>1e-9||res.st!==ref.st)beda++;if(!res.final)belumFinal++}
ok('ada sinyal untuk diuji',n>=10,`(${n} sinyal)`);
ok('resolveSignal sama dengan sim() langsung pada plan yang dicatat',beda===0&&tested===n,`(${tested} sinyal, ${beda} beda)`);
ok('semua final bila horizon sudah lewat',belumFinal===0);
// JSON roundtrip (localStorage): plan harus tetap bisa dinilai setelah serialisasi
const d=await get('SOLUSDT','1d',`endTime=${T0+40*864e5}&limit=500`),f=await get('SOLUSDT','4h',`endTime=${T0+40*864e5}&limit=300`);
let g=null;for(let k=0;k<30&&!g;k++){const ts=T0+(30+k)*864e5;const dd=await get('SOLUSDT','1d',`endTime=${ts}&limit=500`),ff=await get('SOLUSDT','4h',`endTime=${ts}&limit=300`);g=mkSignal(analyze('SOL',dd,ff,{legacy:true,qv:1e9,btcBias:0,ts}),ts)}
const g2=JSON.parse(JSON.stringify(g));
ok('sinyal tahan serialisasi JSON',g2&&g2.plan&&Array.isArray(g2.plan.tg)&&g2.plan.tg.every(t=>typeof t.v==='number'));
const a=await resolveSignal(g,{now:g.ts+30*864e5}),b=await resolveSignal(g2,{now:g.ts+30*864e5});ok('hasil sama sebelum dan sesudah serialisasi',a.R===b.R&&a.st===b.st,`(${a.st} ${a.R.toFixed(2)}R)`);
// candle berjalan dibuang: now di tengah jam => candle terakhir tak dipakai
const mid=g.ts+5*864e5+20*60*1e3,r1=await resolveSignal(g,{now:mid});ok('candle yang belum selesai tidak dipakai',r1.candle===Math.floor(mid/36e5)-Math.ceil(g.ts/36e5),`(${r1.candle} candle)`);
ok('belum final bila horizon belum lewat dan belum tertutup',r1.final===(r1.st==='SL'||r1.st==='target'||r1.st==='target akhir'||r1.st==='TP1 lalu stop di entry'));
// jurnalStats
const S=jurnalStats([{hasil:a},{hasil:b},{}]);ok('jurnalStats menghitung hanya yang dinilai',S.setup===2);
// WIB
ok('wib() benar: keputusan Jul 2026 = Kamis 01:00 WIB',wib(FOMC_TS[10])==='Kamis 2026-07-30 01:00 WIB');
ok('wib() benar: Des 2026 = Kamis 02:00 WIB',wib(FOMC_TS[13])==='Kamis 2026-12-10 02:00 WIB');
ok('jendela: Rabu 13:00 WIB mulai, Kamis 07:00 WIB selesai',fomcIn(Date.parse('2026-07-29T13:00:00+07:00'))===10&&fomcIn(Date.parse('2026-07-29T12:59:00+07:00'))===-1&&fomcIn(Date.parse('2026-07-30T06:59:00+07:00'))===10&&fomcIn(Date.parse('2026-07-30T07:00:00+07:00'))===-1);
console.log(fails?`\n${fails} GAGAL`:'\nSemua uji jurnal dan WIB lolos');process.exit(fails?1:0)
