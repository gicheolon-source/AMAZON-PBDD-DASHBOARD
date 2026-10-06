// Vercel Serverless Function: 구글시트(2026 PBDD) → JSON
// 시트는 "링크가 있는 모든 사용자: 뷰어" 공유 상태여야 합니다. (gviz CSV 내보내기 사용, 키 불필요)
const SHEET_ID = process.env.SHEET_ID || "1UPgaIToxwjCPmxSSgU_WuXxceoUspl48hSUnoB7ZnlM";
const PLAN_SHEET = "PBDD 플랜";
const CONFIG_SHEET = "대시보드 설정"; // 선택: 구글시트에 이 탭을 만들면 목표를 시트에서 바로 바꿀 수 있음

// 국가별 설정: 실시간 시트 이름, 이벤트 창(KST), 목표가 들어있는 플랜 열(0-based)
const COUNTRIES = [
  { code:"US", name:"미국",            sheet:"PBDD 미국 실시간 현황",   start:"2026-10-06T16:00+09:00", end:"2026-10-08T16:00+09:00", unitsCol:2,  revCol:3,  window:"10/6 – 10/7 (PST)" },
  { code:"CA", name:"캐나다",          sheet:"PBDD 캐나다 실시간 현황", start:"2026-10-06T16:00+09:00", end:"2026-10-08T16:00+09:00", unitsCol:4,  revCol:5,  window:"10/6 – 10/7 (PST)" },
  { code:"UK", name:"영국",            sheet:"PBDD 영국 실시간 현황",   start:"2026-10-06T08:00+09:00", end:"2026-10-08T08:00+09:00", unitsCol:6,  revCol:7,  window:"10/6 – 10/7 (BST)" },
  { code:"EU", name:"유럽 (FR·IT·ES)", sheet:"PBDD 유럽 실시간 현황",   start:"2026-10-06T07:00+09:00", end:"2026-10-08T07:00+09:00", unitsCol:10, revCol:11, window:"10/6 – 10/7 (CET)" },
  { code:"AU", name:"호주",            sheet:"PBDD 호주 실시간 현황",   start:"2026-09-28T23:00+09:00", end:"2026-10-05T23:00+09:00", unitsCol:8,  revCol:9,  window:"9/29 – 10/5 (AEST)", goalCell:[2,0] /* A3: 시트 자체 목표 */ },
];
// 플랜 시트 목표 표 (0-based 행, gviz CSV 기준)
// 최종 목표 = 제품별 표(행=제품, 열=국가): 제품 3~10행 + 합계 11행
const PLAN_TABLES = {
  final:      { label:"최종 목표",            rows:[3,4,5,6,7,8,9,10], total:11 },
};
// 현실/공격적 목표 = "PBDD 매출 - 광고" 국가별 표(행=국가): C=현실 매출, D=개수, G=공격적 매출, H=개수
const COUNTRY_GOAL_ROWS = { US:27, CA:28, UK:29, AU:30, EU:31 }; // 표 순서: 미국/캐나다/영국/호주/유럽
// 서버 기본 목표 덮어쓰기 (Vercel 환경변수 GOALS, 예: {"US":800000000,"AU":102130740})
let ENV_GOALS={}; try{ ENV_GOALS=JSON.parse(process.env.GOALS||"{}"); }catch(e){}
// 국가별 기본 목표 출처: final | realistic | aggressive | sheet(실시간 시트 자체 목표)
const DEFAULT_SOURCE = Object.assign({US:"realistic",CA:"final",UK:"final",EU:"final",AU:"sheet"}, (()=>{try{return JSON.parse(process.env.GOAL_SOURCE||"{}")}catch(e){return {}}})());
const PRODUCTS = ["PDRN 20ml","PDRN Max","Ceramide","Retino-Mela","PDRN Lip","PDRN Mask","Copper Peptide","Scalp Serum"];

function canon(h){ // 실시간 시트 헤더 → 표준 제품명
  const s=(h||"").toLowerCase();
  if(s.includes("max")) return "PDRN Max";
  if(s.includes("retino")) return "Retino-Mela";
  if(s.includes("ceramide")) return "Ceramide";
  if(s.includes("lip")) return "PDRN Lip";
  if(s.includes("mask")) return "PDRN Mask";
  if(s.includes("copper")) return "Copper Peptide";
  if(s.includes("scalp")) return "Scalp Serum";
  if(s.includes("pdrn")) return "PDRN 20ml";
  return null;
}
const num = v => { if(v==null) return 0; const n=parseFloat(String(v).replace(/[^0-9.\-]/g,"")); return isNaN(n)?0:n; };

function parseCSV(text){ // RFC4180 간단 파서
  const rows=[]; let row=[], cell="", q=false;
  for(let i=0;i<text.length;i++){ const ch=text[i];
    if(q){ if(ch=='"'){ if(text[i+1]=='"'){cell+='"';i++;} else q=false; } else cell+=ch; }
    else if(ch=='"') q=true;
    else if(ch==','){ row.push(cell); cell=""; }
    else if(ch=='\n'){ row.push(cell); rows.push(row); row=[]; cell=""; }
    else if(ch!='\r') cell+=ch;
  }
  if(cell!==""||row.length){ row.push(cell); rows.push(row); }
  return rows;
}
async function sheet(name){
  const url=`https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(name)}`;
  const r=await fetch(url,{headers:{"cache-control":"no-cache"}});
  if(!r.ok) throw new Error(`${name}: HTTP ${r.status} (시트 공유 설정을 확인하세요)`);
  return parseCSV(await r.text());
}

function readRealtime(rows){
  const header=rows[4]||[];                         // 5행: 헤더
  const revIdx=4;                                   // E열: 매출 (KRW)
  const unitsIdx=header.findIndex(h=>String(h).includes("판매 개수"));
  const prodCols=[]; for(let c=6;c<unitsIdx;c++){ const p=canon(header[c]); if(p) prodCols.push([c,p]); }
  // 일 단위 누적 → 날짜가 바뀌면(마감 행 또는 값이 줄어들면) 완료일 합계로 적립
  let total=0, units=0, prod=Object.fromEntries(PRODUCTS.map(p=>[p,0])), ad=0;
  let dayRev=0, dayUnits=0, dayProd={}, dayAd=0, prevRev=0, elapsedH=0, series=[], lastAt="", lastLabel="";
  const adIdx=header.findIndex(h=>String(h).includes("광고비 합계"));
  const closeDay=()=>{ total+=dayRev; units+=dayUnits; ad+=dayAd; for(const k in dayProd) prod[k]+=dayProd[k]; dayRev=0;dayUnits=0;dayProd={};dayAd=0;prevRev=0; };
  const dayLabels=[];
  for(let r=5;r<rows.length;r++){
    const row=rows[r]||[]; const a=String(row[0]||"");
    const isClose=a.includes("마감");
    const v=num(row[revIdx]);
    if(isClose){ // 마감 행: 값이 있으면 그 날 최종값으로 반영 후 적립
      if(v){ dayRev=v; if(unitsIdx>=0&&num(row[unitsIdx])) dayUnits=num(row[unitsIdx]); prodCols.forEach(([c,p])=>{ if(row[c]!==""&&row[c]!=null) dayProd[p]=num(row[c]); }); if(adIdx>=0&&num(row[adIdx])) dayAd=num(row[adIdx]); series.push({t:a.trim(), v:total+v}); }
      dayLabels.push({label:a.replace(/\s+/g," ").trim(), rev:dayRev, units:dayUnits}); closeDay(); continue; }
    if(!v) continue;
    if(v<prevRev*0.6 && prevRev>0){ dayLabels.push({label:"", rev:dayRev, units:dayUnits}); closeDay(); } // 마감 행 없이 리셋된 경우
    dayRev=v; prevRev=v; elapsedH=r-5-dayLabels.filter(d=>d.label).length+1;
    if(unitsIdx>=0 && num(row[unitsIdx])) dayUnits=num(row[unitsIdx]);
    prodCols.forEach(([c,p])=>{ const q=num(row[c]); if(row[c]!==""&&row[c]!=null) dayProd[p]=q; });
    if(adIdx>=0 && num(row[adIdx])) dayAd=num(row[adIdx]);
    lastAt=`${String(row[0]||"").trim()} (한국 ${String(row[2]||"").trim()})`;
    series.push({t:String(row[0]||"").trim(), v:total+v});
  }
  const cur={rev:total+dayRev, units:units+dayUnits, ad:ad+dayAd, prod:{...prod}};
  for(const k in dayProd) cur.prod[k]+=dayProd[k];
  return {...cur, elapsedH, series, lastAt, days:dayLabels, target:num((rows[1]||[])[1])};
}

module.exports = async (req,res)=>{
  try{
    const [plan, cfgRows, ...rt] = await Promise.all([sheet(PLAN_SHEET), sheet(CONFIG_SHEET).catch(()=>null), ...COUNTRIES.map(c=>sheet(c.sheet))]);
    // "대시보드 설정" 탭: A열 국가코드(US/CA/UK/EU/AU), B열 목표매출(원, 숫자), C열 출처(final/realistic/aggressive/sheet) — B가 있으면 B 우선
    const CFG={};
    (cfgRows||[]).forEach(r=>{ const code=String(r[0]||"").trim().toUpperCase(); if(!/^(US|CA|UK|EU|AU)$/.test(code)) return;
      const rev=num(r[1]); const src=String(r[2]||"").trim().toLowerCase(); CFG[code]={rev, src: ["final","realistic","aggressive","sheet"].includes(src)?src:null}; });
    const now=Date.now();
    const out=COUNTRIES.map((c,i)=>{
      const d=readRealtime(rt[i]);
      const goals={};
      for(const [k,t] of Object.entries(PLAN_TABLES)){
        goals[k]={ label:t.label, rev:num((plan[t.total]||[])[c.revCol]), units:num((plan[t.total]||[])[c.unitsCol]), pGoal:t.rows.map(r=>num((plan[r]||[])[c.unitsCol])) };
      }
      const gr = plan[COUNTRY_GOAL_ROWS[c.code]]||[]; // 국가별 목표 표의 해당 국가 행
      goals.realistic  = { label:"현실 목표",   rev:num(gr[2]), units:num(gr[3]), pGoal:goals.final.pGoal };
      goals.aggressive = { label:"공격적 목표", rev:num(gr[6]), units:num(gr[7]), pGoal:goals.final.pGoal };
      const sheetGoal = c.goalCell ? num((rt[i][c.goalCell[0]]||[])[c.goalCell[1]]) : d.target; // 실시간 시트 자체 목표 (B2 / A3)
      goals.sheet={ label:"실시간 시트 목표", rev:sheetGoal||0, units:goals.final.units, pGoal:goals.final.pGoal };
      const cfg=CFG[c.code]||{};
      const wanted = cfg.src || DEFAULT_SOURCE[c.code];
      const src = goals[wanted] && goals[wanted].rev ? wanted : "final";
      const goal = cfg.rev || ENV_GOALS[c.code] || goals[src].rev;
      const s=Date.parse(c.start), e=Date.parse(c.end);
      const status = now<s ? "wait" : now>=e ? "done" : "live";
      const pace = Math.max(0,Math.min(1,(now-s)/(e-s)));
      const totalH=Math.round((e-s)/36e5);
      return { code:c.code, name:c.name, window:c.window, status, pace, totalH,
        goal, goalSource: cfg.rev?"config":ENV_GOALS[c.code]?"env":src, goals, planGoal:goals.final.rev, goalUnits:goals[src].units,
        rev:d.rev, units:d.units, ad:d.ad, elapsedH:d.elapsedH, lastAt:d.lastAt, series:d.series.slice(-48), days:d.days,
        pGoal:goals[src].pGoal, pAct:PRODUCTS.map(p=>d.prod[p]||0), startsAt:c.start };
    });
    res.setHeader("Cache-Control","s-maxage=300, stale-while-revalidate=600");
    res.setHeader("Content-Type","application/json; charset=utf-8");
    res.status(200).json({ updatedAt:new Date().toISOString(), products:PRODUCTS, sheetUrl:`https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`, countries:out });
  }catch(err){ res.status(500).json({error:String(err.message||err)}); }
};
