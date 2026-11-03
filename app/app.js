(function(){
  let db=null, user=null, canWrite=false;
  let grants=[], tasks=[], meetings=[], settings={}, risks=[], positions=[], requests=[];
  let budgetlines=[], invoices=[], drawdowns=[], timeeffort=[], reports=[], measures=[], amendments=[], subs=[], monitoring=[], opps=[], templates=[], activity=[];
  let osel=null, myId='';
  let sel=null, pendingDelete=null;

  const DAY=86400000;
  const TRACKS=['Setup','Board','Hiring','Existing staff','Subrecipients','Go-live','Monitoring','Reporting','Closeout','Custom'];
  const IMPL=new Set(['Setup','Board','Hiring','Existing staff','Subrecipients','Go-live']);
  const TRACK_COLOR={Setup:'#9fb0c4',Board:'#c9973f',Hiring:'#3f7a53','Existing staff':'#6b8fb5',Subrecipients:'#8a5fa8','Go-live':'#12203a',Monitoring:'#2f8f8f',Reporting:'#a07b2c',Closeout:'#7a4b3a',Custom:'#b3432b'};
  const TIER_LABEL={'1':'Tier 1 · Full','2':'Tier 2 · Charter-Lite','3':'Tier 3 · Tracker'};
  const FORM_LEGAL='https://app.smartsheet.com/b/form/01a01011020e780a9f947477e703ae27';
  const FORM_AGENCY='https://app.smartsheet.com/b/form/247e02a204374624b02c8d7496b9a447';
  const POS_STATUS=['Planned','RTH submitted','Posted','Offer out','Filled'];
  const REQ_STATUS=['Submitted','In review','Approved','Complete','Declined','Closed'];
  const DEFAULT_LT={ amend:30, legal:14, agency:21, finInit:7, dbmsSetup:14, postBoard:7, boardFallback:35, pid:5, rth:7, hrPost:14, interviews:30, offer:21, notice:30, te:10, coc:14, req:21, exec:45 };
  const LT_LABEL={
    amend:'Funder approval of amendments / rebudgets',
    legal:'Legal review turnaround', agency:'Agency staffing request → first shift',
    finInit:'NOA → Intake Form to DBMS', dbmsSetup:'DBMS creates Award/Project/Program # (no Board)', postBoard:'Board approval → DBMS set-up',
    boardFallback:'Board wait if no meeting on calendar', pid:'New grant PID request', rth:'Request to Hire processed', hrPost:'HR posts position',
    interviews:'Interviews & selection', offer:'Offers accepted', notice:'Start-date notice period',
    te:'Time & Effort allocations sent', coc:'Contract request to COC approved', req:'Oracle requisition with SOW', exec:'Supply Chain executes contract'
  };

  const esc=s=>(s==null?'':String(s)).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const $=id=>document.getElementById(id);
  const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n||0);
  const parse=s=>new Date(s+'T00:00:00Z');
  const iso=d=>d.toISOString().slice(0,10);
  const addDays=(s,n)=>iso(new Date(parse(s).getTime()+n*DAY));
  const diffDays=(a,b)=>Math.round((parse(b)-parse(a))/DAY);
  const maxDate=arr=>arr.reduce((m,x)=>x>m?x:m,arr[0]);
  function localToday(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
  const today=localToday();
  const MN=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function fd(s){ if(!s) return '—'; const d=parse(s); return MN[d.getUTCMonth()]+' '+d.getUTCDate()+', '+d.getUTCFullYear(); }
  function fm(m){ const [y,mo]=m.split('-'); return MN[+mo-1]+' '+y; }
  const monthsDiff=(a,b)=>{const [ay,am]=a.split('-').map(Number),[by,bm]=b.split('-').map(Number);return Math.max(0,(by-ay)*12+(bm-am));};
  const monthsF=(a,b)=>Math.max(0,diffDays(a,b)/30.44);
  function monthEnd(s){ const d=parse(s); return iso(new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0))); }
  function monthList(startS,endS){
    const out=[]; let [y,m]=startS.slice(0,7).split('-').map(Number); const end=endS.slice(0,7);
    for(let i=0;i<200;i++){ const k=y+'-'+String(m).padStart(2,'0'); out.push(k); if(k>=end) break; m++; if(m>12){m=1;y++;} }
    return out;
  }
  function lt(){ return Object.assign({},DEFAULT_LT,settings.leadtimes||{}); }
  const awardStart=g=>g.totalStart||g.startDate;
  const awardEnd=g=>g.totalEnd||g.endDate;

  const NAV=[
    {key:'overview',label:'Overview',tabs:[['portfolio','Portfolio']]},
    {key:'pre',label:'1 · Pre-Award',tabs:[['pipeline','Opportunities'],['application','Application Readiness']]},
    {key:'setup',label:'2 · Award Set-Up',tabs:[['intake','New Award'],['templates','Templates'],['detail','Tracks & Tasks'],['requests','Requests & Staffing'],['calendar','Board & Lead Times']]},
    {key:'post',label:'3 · Post-Award',tabs:[['budget','Budget'],['spend','Spend Plan'],['cash','Invoices & Drawdowns'],['effort','Time & Effort'],['reports','Reports & Performance'],['subs','Subrecipients'],['amend','Amendments'],['closeout','Closeout'],['risks','Risks & Issues']]},
    {key:'connect',label:'App Connection (Legal and Agency Staffing)',tabs:[['connsubmit','Request Submission'],['conntrack','Request Tracker']]},
    {key:'admin',label:'Admin',tabs:[['activity','Activity Log'],['config','Settings']]}
  ];
  const SCOPED=new Set(['detail','requests','budget','spend','cash','effort','reports','subs','amend','closeout']);
  let curPhase='overview', curTab='portfolio';
  function drawNav(){
    $('phaseNav').innerHTML=NAV.map(p=>`<button class="phase-btn ${p.key===curPhase?'active':''}" data-phase="${p.key}">${p.label}</button>`).join('');
    const ph=NAV.find(p=>p.key===curPhase);
    $('tabNav').innerHTML=ph.tabs.map(t=>`<button class="tab-btn ${t[0]===curTab?'active':''}" data-tab="${t[0]}">${t[1].replace('&','&amp;')}</button>`).join('');
  }
  function setTab(name){
    const ph=NAV.find(p=>p.tabs.some(t=>t[0]===name)); if(!ph) return;
    curPhase=ph.key; curTab=name; drawNav();
    document.querySelectorAll('.panel').forEach(p=>p.classList.toggle('active',p.id==='panel-'+name));
    $('grantBar').style.display=SCOPED.has(name)?'block':'none';
    try{ if(location.hash!=='#'+curPhase+'-'+name) history.replaceState?location.hash=curPhase+'-'+name:null; }catch(e){}
  }
  $('phaseNav').addEventListener('click',e=>{ const b=e.target.closest('.phase-btn'); if(!b) return; const ph=NAV.find(p=>p.key===b.dataset.phase); setTab(ph.tabs[0][0]); });
  $('tabNav').addEventListener('click',e=>{ const b=e.target.closest('.tab-btn'); if(b) setTab(b.dataset.tab); });
  function tabFromHash(){ try{ const h=(location.hash||'').slice(1); const t=h.split('-').slice(1).join('-'); if(t) setTab(t); }catch(e){} }
  window.addEventListener('hashchange',tabFromHash);
  drawNav();
  function setWriteState(ok){
    canWrite=ok;
    $('readonlyBanner').style.display=ok?'none':'block';
    document.querySelectorAll('button.primary').forEach(b=>b.disabled=!ok);
    $('in-demo').disabled=!ok; $('lifeAll').disabled=!ok;
  }

  // ---------- planning engine ----------
  function nextMeeting(afterDate){
    const list=meetings.slice().sort((a,b)=>a.date.localeCompare(b.date));
    return list.find(m=>m.submitBy>=afterDate)||null;
  }
  function plan(g,mode){
    const L=lt(); const out=[]; const notes=[];
    const add=(track,title,owner,due,gate)=>{out.push({track,title,owner,due,gate:!!gate});return due;};
    const awardLen=(diffDays(awardStart(g),awardEnd(g))+1)/365;
    const annual=g.amount/Math.max(1,awardLen);
    const noa=g.noaDate;
    add('Setup','Send NOA and budget copy to Grants Finance','Program Manager',addDays(noa,2));
    const intakeDue=addDays(noa,L.finInit);
    add('Setup','Grants Finance submits Grants Intake Form to DBMS','Grants Finance',intakeDue);
    let gl;
    if(annual>150000){
      const m=nextMeeting(intakeDue);
      const sub=m?m.submitBy:intakeDue, appr=m?m.date:addDays(intakeDue,L.boardFallback);
      if(!m) notes.push('No Board meeting on the calendar after the intake date. A '+L.boardFallback+'-day wait is assumed. Add upcoming meetings on the Board tab.');
      add('Board','Submit award to CCH Board (Receive & File)','Grants Finance',sub,true);
      add('Board','Board approves award','CCH Board',appr,true);
      gl=addDays(appr,L.postBoard);
    } else gl=addDays(intakeDue,L.dbmsSetup);
    add('Setup','DBMS creates Award, Project & Program #; budget set up in GL','DBMS',gl);
    const ends=[gl]; let cursor=gl; const serial=mode==='serial';
    if(g.hiring){
      const s=serial?cursor:gl;
      const pid=add('Hiring','Request new grant PID','Program Manager',addDays(s,L.pid));
      const rth=add('Hiring','Submit Request to Hire (RTH) with PID and GL','Program Manager',addDays(pid,L.rth));
      const post=add('Hiring','HR processes RTH and posts position','HR',addDays(rth,L.hrPost));
      const iv=add('Hiring','Conduct interviews and select candidates','Program Manager',addDays(post,L.interviews));
      const off=add('Hiring','Candidates accept offers','HR',addDays(iv,L.offer));
      const st=add('Hiring','New hires start','HR',addDays(off,L.notice),true);
      cursor=st; ends.push(st);
    }
    if(g.existing){
      const s=serial?cursor:gl;
      const te=add('Existing staff','Send Time & Effort allocations to the T&E certification mailbox','Program Manager',addDays(s,L.te),true);
      cursor=te; ends.push(te);
    }
    if(g.subs){
      const s=serial?cursor:intakeDue;
      const coc=add('Subrecipients','Submit contract requests to COC for approval','Program Manager',addDays(s,L.coc));
      let ready=coc;
      if(g.subs150){
        const m=nextMeeting(coc);
        const sub=m?m.submitBy:coc, appr=m?m.date:addDays(coc,L.boardFallback);
        if(!m) notes.push('No Board meeting on the calendar for subrecipient contracts. A '+L.boardFallback+'-day wait is assumed.');
        add('Board','Submit subrecipient contracts to Board (over $150k)','Program Manager',sub,true);
        add('Board','Board approves subrecipient contracts','CCH Board',appr,true);
        ready=appr;
      }
      const req=add('Subrecipients','Submit Oracle requisition with COC approval and Scope of Work','Program Manager',addDays(maxDate([ready,gl]),L.req));
      const ex=add('Subrecipients','Supply Chain creates and executes contracts','Supply Chain',addDays(req,L.exec),true);
      cursor=ex; ends.push(ex);
    }
    const impl=maxDate(ends);
    add('Go-live','Begin full grant implementation and spend','Program Manager',impl,true);
    return {tasks:out,impl,notes,annual};
  }
  // Lifecycle checkpoints: the 5-stage checklist turned into dated tasks.
  function lifecycleTasks(g){
    const out=[]; const aEnd=awardEnd(g);
    const add=(track,title,owner,due,gate)=>out.push({track,title,owner,due,gate:!!gate});
    if(!g.continuity) add('Closeout','Draft Funding Continuity Plan: renew, extend, transition or wind down (120 days before end)','Program Manager',addDays(aEnd,-120));
    add('Closeout','Confirm no-cost extension or re-budget decision with funder and Grants Finance (90 days before end)','Program Manager',addDays(aEnd,-90));
    add('Closeout','Finalize staff transition plan with HR and sponsor (90 days before end)','Program Manager',addDays(aEnd,-90));
    add('Closeout','Reconcile final spend, document unspent funds, record lessons learned','Grants Finance',addDays(aEnd,30));
    if(g.nextReport){ const ty=g.nextReportType||'funder';
      add('Reporting','Draft '+ty+' report (10 business days before due)','Program Manager',addDays(g.nextReport,-14));
      add('Reporting','Sponsor reviews '+ty+' report before submission','Sponsor',addDays(g.nextReport,-5));
      add('Reporting','Submit '+ty+' report to funder','Program Manager',g.nextReport,true);
    }
    add('Monitoring','Update Spent to Date and review the pace flag (monthly)','Program Manager',monthEnd(today));
    return out;
  }
  async function addMissingTasks(gid,list){
    const have=new Set(tasks.filter(t=>t.grantId===gid).map(t=>t.title));
    for(const t of list){ if(have.has(t.title)) continue;
      await db.collection('tasks').add({grantId:gid,track:t.track,title:t.title,owner:t.owner,due:t.due,gate:t.gate,done:false,doneAt:''}); }
  }
  function spendSkeleton(g,impl,periodBudget){
    const months=monthList(g.startDate,g.endDate);
    const first=impl.slice(0,7);
    const spendMonths=months.filter(m=>m>=first);
    const map={}; months.forEach(m=>map[m]={p:0,a:null});
    if(!spendMonths.length){ map[months[months.length-1]].p=periodBudget; }
    else{
      const each=Math.floor(periodBudget/spendMonths.length/100)*100; let used=0;
      spendMonths.forEach((m,i)=>{ const v=i===spendMonths.length-1?periodBudget-used:each; map[m].p=v; used+=v; });
    }
    return map;
  }
  function periodBudgetOf(g){
    if(g.periodBudget) return g.periodBudget;
    if(g.totalStart&&g.totalEnd) return Math.round(g.amount*(diffDays(g.startDate,g.endDate)+1)/(diffDays(g.totalStart,g.totalEnd)+1));
    return g.amount;
  }

  const burn=()=>Object.assign({gapYellow:10,gapRed:20,lapseYellow:8,lapseRed:20},settings.burn||{});
  function subNextMonitor(x){ const f=+x.monitorFreq||0; if(!f) return ''; const base=x.lastMonitored||x.start; return base?addMonthsISO(base,f):''; }
  function addMonthsISO(s,n){ const d=parse(s); const y=d.getUTCFullYear(), m=d.getUTCMonth()+n, day=d.getUTCDate(); const last=new Date(Date.UTC(y,m+1,0)).getUTCDate(); return iso(new Date(Date.UTC(y,m,Math.min(day,last)))); }
  // ---------- metrics ----------
  function baseMetrics(g){
    const tk=tasks.filter(t=>t.grantId===g.id);
    const spend=g.spend||{}; const months=Object.keys(spend).sort(); const curM=today.slice(0,7);
    let entSum=0, plannedTo=0, plannedTot=0; const entered=[];
    months.forEach(m=>{ const r=spend[m]||{}; const p=+r.p||0; plannedTot+=p; if(m<=curM) plannedTo+=p;
      if(r.a!==null && r.a!==undefined && r.a!==''){ entSum+=+r.a; entered.push(m);} });
    const manual=(g.spentToDate!==undefined&&g.spentToDate!==null&&g.spentToDate!=='')?+g.spentToDate:null;
    const posted=manual!==null?manual:entSum;
    const accrued=invoices.filter(i=>i.grantId===g.id&&!['Posted','Paid'].includes(i.status)).reduce((a,i)=>a+(+i.amount||0),0);
    const actual=posted+accrued; const B=burn();
    const aS=awardStart(g), aE=awardEnd(g);
    let projected, note='';
    if(manual!==null && actual>0){
      const rate=actual/Math.max(1,monthsF(aS,today));
      projected=actual+rate*monthsF(today,aE);
    } else if(manual===null && entered.length){
      const lastM=entered[entered.length-1];
      const rec=entered.slice(-3).map(m=>+spend[m].a); const avg=rec.reduce((a,b)=>a+b,0)/rec.length;
      projected=actual+avg*monthsDiff(lastM,aE.slice(0,7));
    } else if(!(actual>0) && plannedTo>0){ projected=0; note='No actual spend entered although the monthly plan has started.'; }
    else projected=plannedTot>0?plannedTot:g.amount;
    projected=Math.min(projected,g.amount);
    const lapse=Math.max(0,g.amount-projected);
    const aLen=diffDays(aS,aE)+1;
    const tEl=Math.min(1,Math.max(0,diffDays(aS,today)/aLen));
    const spentPct=g.amount?actual/g.amount:0;
    const gapPts=(tEl-spentPct)*100; const paceDollars=Math.max(0,g.amount*tEl-actual);
    const pLen=diffDays(g.startDate,g.endDate)+1;
    const elapsedP=Math.min(1,Math.max(0,diffDays(g.startDate,today)/pLen));
    const open=tk.filter(t=>!t.done); const dated=open.filter(t=>t.due);
    const overdue=dated.filter(t=>t.due<today); const undated=open.filter(t=>!t.due);
    const unowned=open.filter(t=>!(t.owner&&t.owner.trim()));
    const implT=tk.filter(t=>IMPL.has(t.track)&&t.due);
    const effImpl=implT.length?maxDate(implT.map(t=>t.done?t.due:(t.due<today?today:t.due))):null;
    const reasons=[], sevs=[]; let level=0; const bump=(l,r)=>{ if(l>level) level=l; reasons.push(r); sevs.push(l); };
    let runwayDays=null, runwayPct=null;
    if(effImpl){
      runwayDays=diffDays(effImpl,aE); runwayPct=runwayDays/aLen;
      if(effImpl>=aE) bump(2,'Full implementation lands on or after the award end date');
      else if(runwayPct<0.25) bump(2,'Only '+Math.max(0,Math.round(runwayDays/30.4))+' month(s) of spending runway after go-live');
      else if(runwayPct<0.5) bump(1,'Only '+Math.round(runwayDays/30.4)+' month(s) of runway after go-live ('+Math.round(runwayPct*100)+'% of the award)');
    }
    if(tEl>=0.10||actual>0){
      if(gapPts>=B.gapRed) bump(2,'Escalate to sponsor: spend trails time by '+Math.round(gapPts)+' points ('+money(paceDollars)+' behind pace)');
      else if(gapPts>=B.gapYellow) bump(1,'Spend trails time by '+Math.round(gapPts)+' points ('+money(paceDollars)+' behind pace)');
    }
    const lapsePct=g.amount?lapse/g.amount*100:0;
    if(actual>0||plannedTo>0){ if(lapsePct>=B.lapseRed) bump(2,'Projected lapse of '+money(lapse)+' ('+lapsePct.toFixed(0)+'% of award)'); else if(lapsePct>=B.lapseYellow) bump(1,'Projected lapse of '+money(lapse)+' ('+lapsePct.toFixed(0)+'%)'); }
    if(note) bump(1,note);
    const boardGate=overdue.find(t=>t.gate&&t.track==='Board');
    if(boardGate) bump(2,'Board decision gate overdue: '+boardGate.title);
    if(overdue.length>=4) bump(2,overdue.length+' tasks overdue'); else if(overdue.length>=1) bump(1,overdue.length+' task'+(overdue.length>1?'s':'')+' overdue (confirm and mark done, or re-date)');
    if(undated.length>=3) bump(1,undated.length+' open tasks have no due date');
    const repLate=reports.filter(r=>r.grantId===g.id&&!['Submitted','Accepted'].includes(r.status)&&r.due&&r.due<today);
    if(repLate.length) bump(repLate.some(r=>diffDays(r.due,today)>14)?2:1,repLate.length+' report'+(repLate.length>1?'s':'')+' overdue');
    const teLate=timeeffort.filter(t=>t.grantId===g.id&&t.status!=='Certified'&&t.due&&t.due<today);
    if(teLate.length) bump(1,teLate.length+' time & effort certification'+(teLate.length>1?'s':'')+' overdue');
    const amLate=amendments.filter(a=>a.grantId===g.id&&a.status==='Draft'&&a.neededBy&&addDays(a.neededBy,-(+a.leadDays||0))<today);
    if(amLate.length) bump(1,amLate.length+' amendment or rebudget request'+(amLate.length>1?'s':'')+' past the submit-by date');
    const invOld=invoices.filter(i=>i.grantId===g.id&&!['Posted','Paid'].includes(i.status)&&i.receivedDate&&diffDays(i.receivedDate,today)>30);
    if(invOld.length) bump(1,invOld.length+' invoice'+(invOld.length>1?'s':'')+' received 30+ days ago and not posted');
    const subLate=subs.filter(x=>x.grantId===g.id&&subNextMonitor(x)&&subNextMonitor(x)<today&&x.agreementStatus==='Executed');
    if(subLate.length) bump(1,subLate.length+' subrecipient monitoring review'+(subLate.length>1?'s':'')+' overdue');
    const nextTask=dated.slice().sort((a,b)=>a.due.localeCompare(b.due))[0]||null;
    return {tk,posted,accrued,actual,plannedTo,plannedTot,projected,lapse,lapsePct,tEl,gapPts,paceDollars,spentPct,elapsedP,open,overdue,undated,unowned,effImpl,runwayDays,runwayPct,
      level:['green','yellow','red'][level],levelN:level,reasons,sevs,nextTask,daysLeft:diffDays(today,g.endDate),awardDaysLeft:diffDays(today,aE)};
  }
  const baseCache=()=>{ const c={}; grants.forEach(g=>{c[g.id]=baseMetrics(g);}); return c; };
  function dependents(g){ return grants.filter(x=>Array.isArray(x.dependsOn)&&x.dependsOn.includes(g.id)); }
  function fullMetrics(g,cache){
    const m=Object.assign({},cache?cache[g.id]:baseMetrics(g)); m.reasons=m.reasons.slice(); m.sevs=m.sevs.slice();
    (g.dependsOn||[]).forEach(id=>{ const dg=grants.find(x=>x.id===id); if(!dg) return;
      const dm=cache?cache[id]:baseMetrics(dg);
      if(dm.level==='red'){ m.reasons.push('Depends on '+dg.name+', which is at risk'); m.sevs.push(1); if(m.levelN<1){ m.levelN=1; m.level='yellow'; } } });
    const gated=dependents(g); const bg=(cache?cache[g.id]:baseMetrics(g)).tk.find(t=>!t.done&&t.track==='Board'&&t.gate&&t.due&&diffDays(today,t.due)>=0&&diffDays(today,t.due)<=30);
    if(gated.length&&bg){ m.reasons.push('Board action in '+diffDays(today,bg.due)+' days gates '+gated.length+' other grant'+(gated.length>1?'s':'')); m.sevs.push(1); if(m.levelN<1){ m.levelN=1; m.level='yellow'; } }
    const idx=m.reasons.map((r,i)=>i).sort((a,b)=>m.sevs[b]-m.sevs[a]||a-b);
    m.reasons=idx.map(i=>m.reasons[i]); m.sevs=idx.map(i=>m.sevs[i]);
    return m;
  }
  const riskPill=l=>'<span class="pill '+l+'">'+({green:'On track',yellow:'Watch',red:'At risk'}[l])+'</span>';

  // ---------- PORTFOLIO ----------
  function briefText(rows){
    const L=['CCH Grants: weekly brief, week of '+fd(today),''];
    rows.forEach(({g,m})=>{
      const ask=m.reasons.length?m.reasons[0]:'No decision needed';
      L.push('• '+g.name+' — '+({green:'GREEN',yellow:'YELLOW',red:'RED'}[m.level])+'. Spent '+Math.round(m.spentPct*100)+'% vs '+Math.round(m.tEl*100)+'% of award time ('+money(m.actual)+' of '+money(g.amount)+'). '
        +(m.nextTask?'Next: '+m.nextTask.title+' ('+fd(m.nextTask.due)+'). ':'No dated tasks open. ')+'Ask/flag: '+ask+'.');
    });
    return L.join('\n');
  }
  function renderPortfolio(){
    renderPhaseCards();
    const cache=baseCache();
    const rows=grants.map(g=>({g,m:fullMetrics(g,cache)})).sort((a,b)=>b.m.levelN-a.m.levelN||b.m.lapse-a.m.lapse);
    const totalAward=grants.reduce((s,g)=>s+g.amount,0);
    const totalLapse=rows.reduce((s,r)=>s+(r.m.levelN>0?r.m.lapse:0),0);
    const red=rows.filter(r=>r.m.level==='red').length;
    const od=rows.reduce((s,r)=>s+r.m.overdue.length,0);
    $('pfStats').innerHTML=`
      <div class="stat"><div class="num">${grants.length}</div><div class="muted small">Active grants</div></div>
      <div class="stat"><div class="num">${money(totalAward)}</div><div class="muted small">Total awarded</div></div>
      <div class="stat"><div class="num ${totalLapse>0?'bad':''}">${money(totalLapse)}</div><div class="muted small">Projected to lapse (watch + at risk)</div></div>
      <div class="stat"><div class="num ${red?'bad':''}">${red}</div><div class="muted small">Grants at risk</div></div>
      <div class="stat"><div class="num ${od?'bad':''}">${od}</div><div class="muted small">Overdue tasks</div></div>`;
    if(!grants.length){ $('pfTable').innerHTML='<p class="empty">No grants yet. Add one on the New Award tab, or load the demo grant.</p>'; }
    else $('pfTable').innerHTML='<table><tr><th>Grant</th><th>Status</th><th>Time elapsed</th><th>Spent</th><th>Lapse risk</th><th>Days left</th><th>Why</th></tr>'+rows.map(({g,m})=>{
      const dep=dependents(g);
      return `<tr class="click" data-id="${esc(g.id)}">
        <td><b>${esc(g.name)}</b><div class="small muted">${esc(g.funder||'—')} · ${money(g.amount)} · ${esc(TIER_LABEL[g.tier]||'')}${dep.length?' · <span class="flag-warn">Gates '+dep.length+' grant'+(dep.length>1?'s':'')+'</span>':''}</div></td>
        <td>${riskPill(m.level)}</td>
        <td style="min-width:110px;"><div class="bar-track"><div class="bar-seg" style="width:${m.tEl*100}%; background:#9fb0c4;"></div></div><div class="small muted">${Math.round(m.tEl*100)}% of award</div></td>
        <td style="min-width:130px;"><div class="bar-track"><div class="bar-seg" style="width:${Math.min(100,m.spentPct*100)}%; background:${m.gapPts>=20?'#b3432b':'#3f7a53'};"></div></div><div class="small muted">${money(m.actual)} (${Math.round(m.spentPct*100)}%)</div></td>
        <td class="${m.lapse>0&&m.levelN>0?'flag-bad':''}">${money(m.lapse)}</td>
        <td>${m.daysLeft}${m.awardDaysLeft!==m.daysLeft?'<div class="small muted">award: '+m.awardDaysLeft+'</div>':''}</td>
        <td class="small muted" style="min-width:220px;">${m.reasons.length?esc(m.reasons.slice(0,2).join('; ')):'No flags'}</td>
      </tr>`; }).join('')+'</table>';
    $('pfTable').querySelectorAll('tr.click').forEach(r=>r.addEventListener('click',()=>{ sel=r.dataset.id; renderSelects(); renderDetail(); renderSpend(); setTab('detail'); }));

    const q=[]; grants.forEach(g=>tasks.filter(t=>t.grantId===g.id&&!t.done&&t.due&&diffDays(today,t.due)<=21).forEach(t=>q.push({g,t})));
    q.sort((a,b)=>a.t.due.localeCompare(b.t.due));
    $('pfQueue').innerHTML=q.length?'<table><tr><th>Due</th><th>Task</th><th>Grant</th><th>Owner</th><th></th></tr>'+q.slice(0,40).map(({g,t})=>{
      const d=diffDays(today,t.due);
      return `<tr><td class="${d<0?'flag-bad':(d<=7?'flag-warn':'')}">${fd(t.due)}<div class="small">${d<0?Math.abs(d)+'d overdue':(d===0?'today':'in '+d+'d')}</div></td>
        <td>${t.gate?'◆ ':''}${esc(t.title)}</td><td class="muted">${esc(g.name)}</td><td class="muted">${esc(t.owner||'Unassigned')}</td>
        <td><button class="ghost qdone" data-id="${esc(t.id)}" ${canWrite?'':'disabled'}>Mark done</button></td></tr>`;}).join('')+'</table>':'<p class="empty">Nothing due in the next 21 days.</p>';
    $('pfQueue').querySelectorAll('.qdone').forEach(b=>b.addEventListener('click',()=>setDone(b.dataset.id,true)));

    // data gaps
    const allOpen=tasks.filter(t=>!t.done);
    const undated=allOpen.filter(t=>!t.due).length, unowned=allOpen.filter(t=>!(t.owner&&t.owner.trim())).length;
    const noReport=grants.filter(g=>!g.nextReport).length, noTier=grants.filter(g=>!g.tier).length;
    const staleRisks=risks.filter(r=>riskFlag(r)==='STALE'||riskFlag(r)==='PAST TRIGGER').length;
    const oldReqs=requests.filter(r=>!['Complete','Declined','Closed','Approved'].includes(r.status)&&r.submittedAt&&diffDays(r.submittedAt,today)>14).length;
    const gaps=[
      [oldReqs,'legal or staffing requests have been open more than 14 days','Chase them on the Requests & Staffing tab.'],
      [reports.filter(r=>!['Submitted','Accepted'].includes(r.status)&&r.due&&r.due<today).length,'reports or vouchers are overdue','Mark them submitted or re-date them on the Reports & Performance tab.'],
      [invoices.filter(i=>!['Posted','Paid'].includes(i.status)&&i.receivedDate&&diffDays(i.receivedDate,today)>30).length,'invoices have waited 30+ days to post','Unposted invoices hide true spend.'],
      [timeeffort.filter(t=>t.status!=='Certified'&&t.due&&t.due<today).length,'time & effort certifications are overdue','See the Time & Effort tab.'],
      [amendments.filter(a=>a.status==='Draft'&&a.neededBy&&addDays(a.neededBy,-(+a.leadDays||0))<today).length,'amendment or rebudget requests are past their submit-by date','See the Amendments tab.'],
      [grants.filter(g=>!budgetlines.some(b=>b.grantId===g.id)).length,'grants have no budget lines','Create them on the Budget tab so line-level burn can be tracked.'],
      [undated,'open tasks have no due date','Add dates, or use Re-plan to generate them from lead times.'],
      [unowned,'open tasks have no owner','Unowned deliverables are the ones that get missed.'],
      [staleRisks,'risk-log entries are stale or past trigger','Review them on the Risks & Issues tab.'],
      [noReport,'grants have no next funder report date','Load every report, voucher and invoice date.'],
      [noTier,'grants have no governance tier','Set Tier 1, 2 or 3 on each grant.']
    ].filter(x=>x[0]>0);
    $('pfGaps').innerHTML=gaps.length?'<table>'+gaps.map(x=>`<tr><td style="width:60px;"><b class="flag-warn">${x[0]}</b></td><td>${esc(x[1])}<div class="small muted">${esc(x[2])}</div></td></tr>`).join('')+'</table>':'<p class="empty">No gaps found.</p>';

    $('briefText').textContent=rows.length?briefText(rows):'No grants yet.';
  }
  $('briefCopy').addEventListener('click',async()=>{
    try{ await navigator.clipboard.writeText($('briefText').textContent); $('briefMsg').textContent='Copied.'; }
    catch(e){ $('briefMsg').textContent='Copy blocked here. Select the text above and copy it.'; }
  });
  $('lifeAll').addEventListener('click',async()=>{
    if(!db||!canWrite) return; const b=$('lifeAll'); b.disabled=true; b.textContent='Adding…';
    try{ for(const g of grants) await addMissingTasks(g.id,lifecycleTasks(g)); }catch(e){console.error(e);}
    b.textContent='Add lifecycle checkpoints to every grant'; b.disabled=!canWrite;
  });

  // ---------- INTAKE ----------
  function readIntake(){
    return { name:$('in-name').value.trim(), funder:$('in-funder').value.trim(), sponsor:$('in-sponsor').value.trim(), manager:$('in-mgr').value.trim(), tier:$('in-tier').value,
      amount:parseFloat($('in-amount').value)||0, noaDate:$('in-noa').value, startDate:$('in-start').value, endDate:$('in-end').value,
      totalStart:$('in-tstart').value||'', totalEnd:$('in-tend').value||'', nextReport:$('in-report').value||'', nextReportType:$('in-reporttype').value.trim(),
      hiring:$('in-hiring').checked, existing:$('in-existing').checked, subs:$('in-subs').checked, subs150:$('in-subs').checked&&$('in-subs150').checked,
      mode:$('in-mode').value };
  }
  function validIntake(g){ return g.amount>0 && g.noaDate && g.startDate && g.endDate && g.endDate>g.startDate && (!g.totalStart||!g.totalEnd||g.totalEnd>g.totalStart); }
  function renderPreview(){
    const g=readIntake(); const box=$('preview');
    if(!validIntake(g)){ box.innerHTML='<p class="empty">Enter an amount, NOA date and a valid award period to see the plan.</p>'; return; }
    const p=plan(g,g.mode), ps=plan(g,'serial'), pp=plan(g,'parallel');
    const aS=awardStart(g), aE=awardEnd(g); const total=diffDays(aS,aE)+1;
    const runway=diffDays(p.impl,aE); const pct=runway/total;
    const rm=Math.max(0,Math.round(runway/30.4)), tm=Math.round(total/30.4);
    const gainDays=diffDays(pp.impl,ps.impl);
    let cls='good', msg='';
    if(runway<=0){ cls='bad'; msg='This award cannot be fully implemented before it ends. Negotiate the timeline, or start contingent steps now.'; }
    else if(pct<0.25){ cls='bad'; msg='Only '+rm+' of '+tm+' months are left to spend. Expect a significant lapse unless the plan changes.'; }
    else if(pct<0.5){ cls='warn'; msg='Only '+rm+' of '+tm+' months are left to spend after go-live. Consider an earlier start or a no-cost extension.'; }
    else { msg=rm+' of '+tm+' months of spending runway after go-live. Looks workable.'; }
    box.innerHTML=`
      <div class="banner ${cls}" style="margin-bottom:16px;"><b>${msg}</b></div>
      <div class="compare" style="margin-bottom:16px;">
        <div class="stat"><div class="muted small">As mapped today (serial)</div><div class="num">${fd(ps.impl)}</div><div class="small muted">${Math.max(0,diffDays(ps.impl,aE))} days left to spend</div></div>
        <div class="stat"><div class="muted small">Parallel tracks</div><div class="num">${fd(pp.impl)}</div><div class="small muted">${gainDays>0?'<span class="flag-ok">'+gainDays+' days earlier</span>':'No difference for this award'}</div></div>
        <div class="stat"><div class="muted small">Annual award</div><div class="num">${money(p.annual)}</div><div class="small muted">${p.annual>150000?'Over $150k: Board required':'At or under $150k: no Board for the award'}</div></div>
      </div>
      ${p.notes.length?'<div class="banner warn" style="margin-bottom:16px;">'+p.notes.map(esc).join('<br>')+'</div>':''}
      <div class="scroll"><table><tr><th>Track</th><th>Task</th><th>Owner</th><th>Planned date</th></tr>
      ${p.tasks.slice().sort((a,b)=>a.due.localeCompare(b.due)).map(t=>`<tr><td><span class="dot" style="background:${TRACK_COLOR[t.track]}"></span>${esc(t.track)}</td><td>${t.gate?'◆ ':''}${esc(t.title)}</td><td class="muted">${esc(t.owner)}</td><td>${fd(t.due)}</td></tr>`).join('')}
      </table></div>
      <p class="small muted" style="margin-top:12px;">Reporting, monitoring and closeout checkpoints are added automatically on save. Parallel mode assumes hiring and T&amp;E start once the grant is set up in the GL, and contract requests start once the intake is submitted. Verify with HR, DBMS and COC. ◆ marks decision gates.</p>`;
  }
  ['in-name','in-funder','in-sponsor','in-mgr','in-tier','in-amount','in-noa','in-start','in-end','in-tstart','in-tend','in-report','in-reporttype','in-hiring','in-existing','in-subs','in-subs150','in-mode'].forEach(id=>{
    $(id).addEventListener('input',renderPreview); $(id).addEventListener('change',renderPreview);
  });
  $('in-subs').addEventListener('change',()=>{ $('in-subs150').disabled=!$('in-subs').checked; if(!$('in-subs').checked) $('in-subs150').checked=false; renderPreview(); });

  async function createGrant(g,opts){
    opts=opts||{};
    const p=plan(g,g.mode);
    const pb=periodBudgetOf(g);
    const doc={name:g.name,funder:g.funder||'',sponsor:g.sponsor||'',manager:g.manager||'',tier:g.tier||'2',amount:g.amount,noaDate:g.noaDate,startDate:g.startDate,endDate:g.endDate,
      hiring:g.hiring,existing:g.existing,subs:g.subs,subs150:g.subs150,mode:g.mode,periodBudget:pb,
      spend:spendSkeleton(g,p.impl,pb),createdAt:new Date().toISOString()};
    if(g.totalStart&&g.totalEnd){ doc.totalStart=g.totalStart; doc.totalEnd=g.totalEnd; }
    if(g.nextReport){ doc.nextReport=g.nextReport; doc.nextReportType=g.nextReportType||''; }
    const ref=await db.collection('grants').add(doc);
    const gid=ref&&ref.id?ref.id:(ref&&ref.path?ref.path.split('/').pop():null);
    if(!gid) throw new Error('no id');
    const all=p.tasks.concat(lifecycleTasks(doc));
    for(const t of all){
      const done=!!(opts.markPastDone && t.due<addDays(today,-7) && IMPL.has(t.track));
      await db.collection('tasks').add({grantId:gid,track:t.track,title:t.title,owner:t.owner,due:t.due,gate:t.gate,done,doneAt:done?t.due:''});
    }
    const tpl=opts.template;
    const reps=tpl&&tpl.reportsText?parseReports(tpl.reportsText):(g.nextReport?[{name:(g.nextReportType||'Funder')+' report',freq:'One-time',due:g.nextReport}]:[]);
    for(const r of reps){ const due=r.due||(FREQ_M[r.freq]?addMonthsISO(g.startDate,FREQ_M[r.freq]):awardEnd(g)); await db.collection('reports').add({grantId:gid,name:r.name,freq:r.freq,due,owner:'',status:'Not started',submittedAt:''}); }
    if(tpl&&tpl.splitText){ for(const l of parseSplit(tpl.splitText)){ const cat=CATS.find(c=>c.toLowerCase()===l.category.toLowerCase())||l.category; const amt=Math.round(g.amount*l.pct/100); await db.collection('budgetlines').add({grantId:gid,category:cat,approved:amt,current:amt,expended:0,encumbered:0,inBase:!NOT_BASE.has(cat),note:''}); } }
    logAct(gid,'Created award: '+g.name+(tpl?' from template '+tpl.name:''));
    return gid;
  }
  $('intakeForm').addEventListener('submit',async e=>{
    e.preventDefault(); if(!db||!canWrite) return;
    const g=readIntake(); if(!g.name||!validIntake(g)) return;
    const btn=$('in-save'); btn.disabled=true; btn.textContent='Creating…';
    try{ const id=await createGrant(g,{template:templates.find(t=>t.id===$('in-template').value)}); sel=id; e.target.reset(); initIntakeDefaults(); renderSelects(); setTab('detail'); }
    catch(err){ console.error('create failed',err); }
    btn.textContent='Create award & tracks'; btn.disabled=!canWrite;
  });
  $('in-demo').addEventListener('click',async()=>{
    if(!db||!canWrite) return;
    const btn=$('in-demo'); btn.disabled=true; btn.textContent='Loading…';
    const g={name:'DEMO: State Behavioral Health Capacity Grant',funder:'State agency (demo)',sponsor:'Demo Sponsor',manager:'Demo Manager',tier:'2',amount:1200000,
      noaDate:addDays(today,-110),startDate:addDays(today,-90),endDate:addDays(addDays(today,-90),364),totalStart:'',totalEnd:'',
      nextReport:addDays(today,40),nextReportType:'PPR',hiring:true,existing:true,subs:true,subs150:true,mode:'parallel'};
    try{ const id=await createGrant(g,{markPastDone:true}); sel=id; renderSelects(); }catch(err){ console.error('demo failed',err); }
    btn.textContent='Load a demo grant'; btn.disabled=!canWrite;
  });
  function initIntakeDefaults(){
    $('in-noa').value=today; $('in-start').value=addDays(today,14);
    const e=new Date(parse(addDays(today,14)).getTime()); e.setUTCFullYear(e.getUTCFullYear()+1); e.setUTCDate(e.getUTCDate()-1);
    $('in-end').value=iso(e); $('in-subs150').disabled=true; renderPreview();
  }

  // ---------- selects ----------
  function renderSelects(){
    const opts=grants.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(g=>`<option value="${esc(g.id)}" ${g.id===sel?'selected':''}>${esc(g.name)}</option>`).join('');
    $('gsel').innerHTML=opts||'<option value="">No grants yet</option>';
    if(!grants.find(g=>g.id===sel)) sel=grants.length?grants[0].id:null;
    if(sel) $('gsel').value=sel;
    $('grantNames').innerHTML=grants.map(g=>`<option value="${esc(g.name)}">`).join('');
  }
  $('gsel').addEventListener('change',e=>{ sel=e.target.value; pendingDelete=null; renderSelects(); renderScoped(); });

  // ---------- DETAIL ----------
  async function setDone(id,done){ if(!db||!canWrite) return; const t=tasks.find(x=>x.id===id); try{ await db.collection('tasks').doc(id).update({done:!!done,doneAt:done?today:''}); if(t) logAct(t.grantId,(done?'Completed: ':'Reopened: ')+t.title); }catch(e){console.error(e);} }
  async function updateGrant(id,patch){ if(!db||!canWrite) return; try{ await db.collection('grants').doc(id).update(patch); if('spentToDate' in patch) logAct(id,'Updated spent to date: '+(patch.spentToDate==null?'cleared':money(patch.spentToDate))); }catch(e){console.error(e);} }
  async function replan(g,mode){
    if(!db||!canWrite) return;
    const p=plan(g,mode); const mine=tasks.filter(t=>t.grantId===g.id);
    try{
      for(const nt of p.tasks){
        const ex=mine.find(t=>t.title===nt.title);
        if(ex){ if(!ex.done) await db.collection('tasks').doc(ex.id).update({due:nt.due,owner:ex.owner||nt.owner,track:nt.track,gate:nt.gate}); }
        else await db.collection('tasks').add({grantId:g.id,track:nt.track,title:nt.title,owner:nt.owner,due:nt.due,gate:nt.gate,done:false,doneAt:''});
      }
      await db.collection('grants').doc(g.id).update({mode});
    }catch(e){console.error('replan failed',e);}
  }
  function renderDetail(){
    const body=$('detailBody'); const g=grants.find(x=>x.id===sel);
    if(!g){ body.innerHTML='<div class="card"><p class="empty">No grant selected. Add one on the New Award tab.</p></div>'; return; }
    const cache=baseCache(); const m=fullMetrics(g,cache);
    const noa=g.noaDate||awardStart(g); const gg=Object.assign({},g,{noaDate:noa});
    const ps=plan(gg,'serial'), pp=plan(gg,'parallel'); const gain=diffDays(pp.impl,ps.impl);
    const deps=(g.dependsOn||[]).map(id=>grants.find(x=>x.id===id)).filter(Boolean); const gates=dependents(g);
    const gk=r=>r.due?r.due:'9999-12-31';
    const trackRows=TRACKS.map(tr=>{ const list=m.tk.filter(t=>t.track===tr).sort((a,b)=>gk(a).localeCompare(gk(b))); if(!list.length) return '';
      const done=list.filter(t=>t.done).length;
      return `<div style="margin-bottom:22px;">
        <h3 style="margin-bottom:8px;"><span class="dot" style="background:${TRACK_COLOR[tr]}"></span>${esc(tr)} <span class="small muted" style="font-weight:400;">${done}/${list.length} done</span></h3>
        <div class="scroll"><table><tr><th style="width:40px;"></th><th>Task</th><th style="width:200px;">Owner</th><th style="width:170px;">Due</th><th style="width:90px;"></th></tr>
        ${list.map(t=>{ const d=t.due?diffDays(today,t.due):null; const od=!t.done&&d!==null&&d<0; return `<tr data-id="${esc(t.id)}">
          <td><input type="checkbox" class="t-done" data-id="${esc(t.id)}" ${t.done?'checked':''} ${canWrite?'':'disabled'}></td>
          <td style="${t.done?'text-decoration:line-through; color:var(--ink-soft);':''}">${t.gate?'◆ ':''}${esc(t.title)}${od?'<div class="small flag-bad" style="text-decoration:none;">'+Math.abs(d)+' days overdue</div>':''}${!t.done&&!t.due?'<div class="small flag-warn">No due date</div>':''}${t.done&&t.doneAt?'<div class="small muted">Done '+fd(t.doneAt)+'</div>':''}</td>
          <td><input type="text" class="t-owner" data-id="${esc(t.id)}" value="${esc(t.owner||'')}" placeholder="Assign an owner" ${canWrite?'':'disabled'}></td>
          <td><input type="date" class="t-due" data-id="${esc(t.id)}" value="${esc(t.due||'')}" ${canWrite?'':'disabled'}></td>
          <td>${tr==='Custom'?`<button class="ghost t-del" data-id="${esc(t.id)}" ${canWrite?'':'disabled'}>Remove</button>`:''}</td></tr>`; }).join('')}
        </table></div></div>`; }).join('');
    body.innerHTML=`
      <div class="card">
        <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:flex-start; margin-bottom:14px;">
          <div><h2>${esc(g.name)}</h2><p class="small muted" style="margin:4px 0 0;">${esc(g.funder||'—')} · ${money(g.amount)} · Sponsor: ${esc(g.sponsor||'—')} · PM: ${esc(g.manager||'—')}</p></div>
          <div>${riskPill(m.level)}</div>
        </div>
        ${m.reasons.length?'<div class="banner '+(m.level==='red'?'bad':'warn')+'" style="margin-bottom:14px;">'+m.reasons.map(esc).join('<br>')+'</div>':'<div class="banner good" style="margin-bottom:14px;">No flags. Tasks and spend are on plan.</div>'}
        <div class="compare">
          <div class="stat"><div class="muted small">Spend pace</div><div class="num">${Math.round(m.spentPct*100)}% vs ${Math.round(m.tEl*100)}%</div><div class="small muted">spent vs award time elapsed${m.paceDollars>0?' · '+money(m.paceDollars)+' behind pace':''}</div></div>
          <div class="stat"><div class="muted small">Projected lapse</div><div class="num ${m.lapse>0&&m.levelN>0?'bad':''}">${money(m.lapse)}</div><div class="small muted">at run rate to ${fd(awardEnd(g))}</div></div>
          <div class="stat"><div class="muted small">${m.effImpl?'Expected go-live (current plan)':'Go-live'}</div><div class="num">${m.effImpl?fd(m.effImpl):'No dated go-live'}</div><div class="small muted">${m.runwayDays!==null?Math.max(0,Math.round(m.runwayDays/30.4))+' months to spend':'Add dates or Re-plan'}</div></div>
          <div class="stat"><div class="muted small">Tasks</div><div class="num">${m.tk.length-m.open.length}/${m.tk.length}</div><div class="small muted">${m.overdue.length} overdue · ${m.undated.length} undated · ${m.unowned.length} unowned</div></div>
        </div>
        <div class="compare" style="margin-top:12px;">
          <div class="stat"><div class="muted small">If run serially (from NOA)</div><div class="num">${fd(ps.impl)}</div></div>
          <div class="stat"><div class="muted small">If run in parallel (from NOA)</div><div class="num">${fd(pp.impl)}</div><div class="small muted">${gain>0?'<span class="flag-ok">'+gain+' days earlier</span>':'Same date'}</div></div>
        </div>
        <div style="margin-top:14px; display:flex; gap:8px; flex-wrap:wrap;">
          <button class="ghost" id="rp-par" ${canWrite?'':'disabled'}>Re-plan open tasks in parallel</button>
          <button class="ghost" id="rp-ser" ${canWrite?'':'disabled'}>Re-plan open tasks as mapped (serial)</button>
          <button class="ghost" id="life-one" ${canWrite?'':'disabled'}>Add lifecycle checkpoints</button>
          <button class="ghost danger" id="del-grant" ${canWrite?'':'disabled'}>${pendingDelete===g.id?'Click again to delete this grant':'Delete grant'}</button>
        </div>
        <p class="small muted" style="margin-top:8px;">Re-planning adds the process-map tasks and updates due dates on open tasks from the current lead times and Board calendar. Completed tasks are untouched. Lifecycle checkpoints add the 120/90-day closeout steps, report drafting and review, and monthly spend update.</p>
      </div>
      <div class="card">
        <h3 style="margin-bottom:12px;">Award facts</h3>
        <div class="facts">
          <div><b>Award period</b>${fd(awardStart(g))} to ${fd(awardEnd(g))}</div>
          <div><b>Current budget period</b>${fd(g.startDate)} to ${fd(g.endDate)} (${m.daysLeft} days left)</div>
          <div class="field"><b>Spent to date ($, cumulative from Oracle)</b><input type="number" id="f-spent" min="0" step="any" value="${g.spentToDate!=null&&g.spentToDate!==''?Math.round(g.spentToDate*100)/100:''}" placeholder="Enter amount" ${canWrite?'':'disabled'}></div>
          <div class="field"><b>Governance tier</b><select id="f-tier" ${canWrite?'':'disabled'}>${['1','2','3'].map(t=>`<option value="${t}" ${String(g.tier)===t?'selected':''}>${TIER_LABEL[t]}</option>`).join('')}</select></div>
          <div class="field"><b>Next funder report due</b><input type="date" id="f-report" value="${esc(g.nextReport||'')}" ${canWrite?'':'disabled'}></div>
          <div class="field"><b>Report type</b><input type="text" id="f-reporttype" value="${esc(g.nextReportType||'')}" ${canWrite?'':'disabled'}></div>
          ${g.boardNote?`<div><b>Board / approval</b>${esc(g.boardNote)}</div>`:''}
          ${g.continuity?`<div><b>Funding continuity plan</b>${esc(g.continuity)}</div>`:'<div><b>Funding continuity plan</b><span class="flag-warn">None on file. Draft it 120 days before end.</span></div>'}
          ${deps.length?`<div><b>Depends on</b>${deps.map(d=>esc(d.name)).join('; ')}</div>`:''}
          ${gates.length?`<div><b>Gates</b>${gates.map(d=>esc(d.name)).join('; ')}</div>`:''}
          ${g.notes?`<div style="grid-column:1/-1;"><b>Notes</b>${esc(g.notes)}</div>`:''}
        </div>
      </div>
      <div class="card">${trackRows||'<p class="empty">No tasks.</p>'}
        <div style="border-top:1px solid var(--border); padding-top:16px;">
          <h3 style="margin-bottom:10px;">Add a task</h3>
          <form class="row" id="taskForm">
            <div class="field" style="flex:2; min-width:220px;"><label>Task</label><input type="text" id="nt-title" required></div>
            <div class="field"><label>Owner</label><input type="text" id="nt-owner"></div>
            <div class="field"><label>Track</label><select id="nt-track">${TRACKS.map(t=>`<option ${t==='Custom'?'selected':''}>${t}</option>`).join('')}</select></div>
            <div class="field"><label>Due</label><input type="date" id="nt-due" required></div>
            <button class="primary" type="submit" ${canWrite?'':'disabled'}>Add task</button>
          </form>
        </div>
      </div>`;
    body.querySelectorAll('.t-done').forEach(c=>c.addEventListener('change',e=>setDone(c.dataset.id,e.target.checked)));
    body.querySelectorAll('.t-owner').forEach(c=>c.addEventListener('change',async e=>{ if(!canWrite) return; try{await db.collection('tasks').doc(c.dataset.id).update({owner:e.target.value});}catch(x){console.error(x);} }));
    body.querySelectorAll('.t-due').forEach(c=>c.addEventListener('change',async e=>{ if(!canWrite) return; try{await db.collection('tasks').doc(c.dataset.id).update({due:e.target.value||''});}catch(x){console.error(x);} }));
    body.querySelectorAll('.t-del').forEach(c=>c.addEventListener('click',async()=>{ if(!canWrite) return; try{await db.collection('tasks').doc(c.dataset.id).delete();}catch(x){console.error(x);} }));
    $('f-spent').addEventListener('change',e=>updateGrant(g.id,{spentToDate:e.target.value===''?null:Math.max(0,parseFloat(e.target.value)||0)}));
    $('f-tier').addEventListener('change',e=>updateGrant(g.id,{tier:e.target.value}));
    $('f-report').addEventListener('change',e=>updateGrant(g.id,{nextReport:e.target.value||''}));
    $('f-reporttype').addEventListener('change',e=>updateGrant(g.id,{nextReportType:e.target.value}));
    $('rp-par').addEventListener('click',()=>replan(gg,'parallel'));
    $('rp-ser').addEventListener('click',()=>replan(gg,'serial'));
    $('life-one').addEventListener('click',async()=>{ if(!db||!canWrite) return; try{ await addMissingTasks(g.id,lifecycleTasks(g)); }catch(x){console.error(x);} });
    $('del-grant').addEventListener('click',async()=>{
      if(!db||!canWrite) return;
      if(pendingDelete!==g.id){ pendingDelete=g.id; renderDetail(); return; }
      try{ for(const t of tasks.filter(t=>t.grantId===g.id)) await db.collection('tasks').doc(t.id).delete(); await db.collection('grants').doc(g.id).delete(); pendingDelete=null; }catch(x){console.error(x);}
    });
    $('taskForm').addEventListener('submit',async e=>{
      e.preventDefault(); if(!db||!canWrite) return;
      try{ await db.collection('tasks').add({grantId:g.id,track:$('nt-track').value,title:$('nt-title').value.trim(),owner:$('nt-owner').value.trim(),due:$('nt-due').value,gate:false,done:false,doneAt:''}); }catch(x){console.error(x);}
    });
  }

  // ---------- SPEND ----------
  async function saveSpend(g,month,field,val){
    if(!db||!canWrite) return;
    const sp=JSON.parse(JSON.stringify(g.spend||{})); sp[month]=sp[month]||{p:0,a:null};
    if(field==='a') sp[month].a=(val===''||val==null)?null:Math.max(0,parseFloat(val)||0);
    else sp[month].p=Math.max(0,parseFloat(val)||0);
    await updateGrant(g.id,{spend:sp});
  }
  function spendChart(g,m){
    const spend=g.spend||{}; const months=Object.keys(spend).sort(); if(months.length<2) return '';
    const budget=periodBudgetOf(g);
    const W=720,H=230,pl=60,pr=16,pt=14,pb=30; const iw=W-pl-pr, ih=H-pt-pb; const max=budget*1.02;
    const x=i=>pl+iw*(i/(months.length-1)); const y=v=>pt+ih*(1-Math.min(v,max)/max);
    let cp=0,ca=0; const planPts=[],actPts=[]; let lastIdx=-1;
    months.forEach((mo,i)=>{ cp+=+spend[mo].p||0; planPts.push([x(i),y(cp)]);
      const a=spend[mo].a; if(a!==null&&a!==undefined&&a!==''){ ca+=+a; actPts.push([x(i),y(ca)]); lastIdx=i; } });
    const line=pts=>pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ');
    const curI=months.indexOf(today.slice(0,7));
    const grid=[0,.25,.5,.75,1].map(f=>`<line x1="${pl}" x2="${W-pr}" y1="${y(max*f)}" y2="${y(max*f)}" stroke="var(--border)"/><text x="${pl-8}" y="${y(max*f)+4}" text-anchor="end" font-size="11" fill="var(--ink-soft)">${f===0?'$0':'$'+Math.round(budget*f/1000)+'k'}</text>`).join('');
    const ticks=months.map((mo,i)=>(i%Math.ceil(months.length/8)===0)?`<text x="${x(i)}" y="${H-10}" text-anchor="middle" font-size="11" fill="var(--ink-soft)">${fm(mo).replace(' 20',' ’')}</text>`:'').join('');
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto;" role="img" aria-label="Cumulative planned and actual spend by month">
      ${grid}${ticks}
      ${curI>=0?`<line x1="${x(curI)}" x2="${x(curI)}" y1="${pt}" y2="${H-pb}" stroke="var(--ink-soft)" stroke-dasharray="2 4"/>`:''}
      <path d="${line(planPts)}" stroke="#9fb0c4" stroke-width="2.5" fill="none"/>
      ${actPts.length?`<path d="${line(actPts)}" stroke="#3f7a53" stroke-width="3" fill="none"/>`:''}
    </svg>
    <p class="small muted"><span class="dot" style="background:#9fb0c4"></span>Planned (cumulative, this budget period) &nbsp; <span class="dot" style="background:#3f7a53"></span>Actual (monthly entries) &nbsp; · dotted line = today</p>`;
  }
  function renderSpend(){
    const body=$('spendBody'); const g=grants.find(x=>x.id===sel);
    if(!g){ body.innerHTML='<div class="card"><p class="empty">No grant selected.</p></div>'; return; }
    const m=fullMetrics(g,baseCache()); const spend=g.spend||{}; const months=Object.keys(spend).sort(); const curM=today.slice(0,7);
    const budget=periodBudgetOf(g);
    let cp=0,ca=0;
    const rows=months.map(mo=>{ const r=spend[mo]||{p:0,a:null}; cp+=+r.p||0; const has=r.a!==null&&r.a!==undefined&&r.a!==''; if(has){ca+=+r.a;}
      const behind=mo<=curM&&has&&(+r.p>0)&&(+r.a<+r.p*0.8);
      return `<tr style="${mo===curM?'background:var(--panel-2);':''}"><td>${fm(mo)}${mo===curM?' <span class="small muted">(this month)</span>':''}</td>
        <td><input type="number" class="sp-p" data-m="${mo}" min="0" step="any" value="${Math.round(+r.p||0)}" style="max-width:130px;" ${canWrite?'':'disabled'}></td>
        <td><input type="number" class="sp-a" data-m="${mo}" min="0" step="any" value="${has?Math.round(+r.a):''}" placeholder="—" style="max-width:130px;" ${canWrite?'':'disabled'}></td>
        <td class="muted">${money(cp)}</td><td class="${behind?'flag-bad':'muted'}">${has?money(ca):'—'}${behind?' (behind)':''}</td></tr>`; }).join('');
    const planSum=months.reduce((s,mo)=>s+(+spend[mo].p||0),0);
    const manual=g.spentToDate!=null&&g.spentToDate!=='';
    body.innerHTML=`
      <div class="grid-stats">
        <div class="stat"><div class="num">${money(g.amount)}</div><div class="muted small">Total award</div></div>
        <div class="stat"><div class="num">${money(m.actual)}</div><div class="muted small">Spent to date</div></div>
        <div class="stat"><div class="num">${money(m.projected)}</div><div class="muted small">Projected by award end</div></div>
        <div class="stat"><div class="num ${m.lapse>0&&m.levelN>0?'bad':''}">${money(m.lapse)}</div><div class="muted small">Projected lapse</div></div>
        <div class="stat"><div class="num ${m.gapPts>=20?'bad':''}">${Math.round(m.spentPct*100)}% / ${Math.round(m.tEl*100)}%</div><div class="muted small">Spent vs award time elapsed</div></div>
      </div>
      <div class="card"><h3 style="margin-bottom:10px;">Spent to date</h3>
        <form class="row" id="spentForm"><div class="field" style="min-width:240px;"><label>Cumulative spend from Oracle ($)</label><input type="number" id="sp-manual" min="0" step="any" value="${manual?Math.round(g.spentToDate*100)/100:''}" ${canWrite?'':'disabled'}></div>
        <button class="primary" type="submit" ${canWrite?'':'disabled'}>Save</button></form>
        <p class="small muted" style="margin-top:10px;">${manual?'This number drives the pace check and the projection. The projection assumes the average monthly spend since the award began continues to the award end date.':'No cumulative figure entered, so the monthly actuals below are used (average of the last three months).'}</p>
        <p class="small muted">Tip: also track invoices received but not yet posted. A contractor that bills two months late makes spend look lower than it is.</p>
      </div>
      <div class="card"><h2 style="margin-bottom:10px;">Cumulative spend</h2>${spendChart(g,m)||'<p class="empty">No monthly plan yet.</p>'}
        ${months.length&&Math.round(planSum)!==Math.round(budget)?`<div class="banner warn" style="margin-top:12px;">The monthly plan totals ${money(planSum)}, but this budget period's share of the award is about ${money(budget)}.</div>`:''}
      </div>
      <div class="card"><h2 style="margin-bottom:10px;">Monthly plan vs actual</h2>
        ${months.length?`<div class="scroll"><table><tr><th>Month</th><th>Planned ($)</th><th>Actual ($)</th><th>Cum. planned</th><th>Cum. actual</th></tr>${rows}</table></div>`:
        `<p class="empty">No monthly plan yet for this grant.</p><button class="ghost" id="mkplan" ${canWrite?'':'disabled'}>Create a monthly plan to the end of this budget period</button>`}
      </div>`;
    body.querySelectorAll('.sp-p').forEach(i=>i.addEventListener('change',e=>saveSpend(g,i.dataset.m,'p',e.target.value)));
    body.querySelectorAll('.sp-a').forEach(i=>i.addEventListener('change',e=>saveSpend(g,i.dataset.m,'a',e.target.value)));
    $('spentForm').addEventListener('submit',e=>{ e.preventDefault(); const v=$('sp-manual').value; updateGrant(g.id,{spentToDate:v===''?null:Math.max(0,parseFloat(v)||0)}); });
    const mk=$('mkplan'); if(mk) mk.addEventListener('click',async()=>{
      const aS=awardStart(g), aE=awardEnd(g); const spent=m.actual;
      const target=g.amount*Math.min(1,(diffDays(aS,g.endDate)+1)/(diffDays(aS,aE)+1));
      const remaining=Math.max(0,Math.round(target-spent));
      const startM=curM>g.startDate.slice(0,7)?curM:g.startDate.slice(0,7);
      const list=monthList(startM+'-01',g.endDate); const sp={};
      monthList(g.startDate,g.endDate).forEach(mo=>{ sp[mo]={p:0,a:null}; });
      const each=Math.floor(remaining/list.length/100)*100; let used=0;
      list.forEach((mo,i)=>{ const v=i===list.length-1?remaining-used:each; sp[mo].p=v; used+=v; });
      await updateGrant(g.id,{spend:sp,periodBudget:Math.round(target)});
    });
  }


  // ---------- REQUESTS & STAFFING ----------
  function posCalc(g,p){
    const fte=+p.fte||0, sal=+p.salary||0, fr=(p.fringe===''||p.fringe==null)?30:+p.fringe;
    const monthly=fte*sal*(1+fr/100)/12;
    const from=p.start||p.needBy||g.startDate; const a=from>g.startDate?from:g.startDate;
    const months=a<g.endDate?monthsF(a,g.endDate):0;
    const filled=p.status==='Filled';
    const startEff=p.start||today;
    const vacancy=(!filled&&p.needBy&&p.needBy<today)?monthly*monthsF(p.needBy,startEff<today?startEff:today):0;
    const gapDays=(p.needBy&&p.start)?diffDays(p.needBy,p.start):((!filled&&p.needBy&&p.needBy<today)?diffDays(p.needBy,today):0);
    return {monthly,months,costPeriod:monthly*months,vacancy,gapDays,filled};
  }
  function reqSummary(g,kind,extra){
    const lines=['Grant: '+g.name,'Funder: '+(g.funder||'—'),'Award: '+money(g.amount)+' ('+fd(awardStart(g))+' to '+fd(awardEnd(g))+')','Current budget period: '+fd(g.startDate)+' to '+fd(g.endDate),'Sponsor: '+(g.sponsor||'—')+' · Program manager: '+(g.manager||'—')];
    return lines.concat(extra).join('\n');
  }
  async function copyText(txt,msgEl){
    try{ await navigator.clipboard.writeText(txt); msgEl.textContent='Copied. Paste it into the form.'; }
    catch(e){ msgEl.textContent='Copy blocked here. Select and copy the text from the log instead.'; }
  }
  function renderRequests(){
    const body=$('reqBody'); const g=grants.find(x=>x.id===sel);
    if(!g){ body.innerHTML='<div class="card"><p class="empty">No grant selected. Add one on the New Award tab.</p></div>'; return; }
    const keep={}; body.querySelectorAll('[id^="rq-"]').forEach(el=>{ keep[el.id]=(el.type==='checkbox')?el.checked:el.value; });
    const L=lt();
    const pos=positions.filter(p=>p.grantId===g.id);
    const reqs=requests.filter(r=>r.grantId===g.id).sort((a,b)=>(b.submittedAt||'').localeCompare(a.submittedAt||''));
    const contractTask=tasks.filter(t=>t.grantId===g.id&&!t.done&&t.due&&!/^(Legal review|Agency staffing)/.test(t.title)&&/contract|agreement|requisition|COC|amendment/i.test(t.title)).sort((a,b)=>a.due.localeCompare(b.due))[0];
    const neededBy=contractTask?addDays(contractTask.due,-L.legal):addDays(today,L.legal+7);
    const reasons=[['Subrecipient agreements or amendments',!!g.subs],['Contracts over $150k (Board approval needed)',!!g.subs150],['Data sharing agreement or MOU',false],['Non-standard award terms or conditions',false],['Vendor or procurement contract language',false]];
    const rows=pos.map(p=>({p,c:posCalc(g,p)}));
    const tot=rows.reduce((a,r)=>({cost:a.cost+r.c.costPeriod,vac:a.vac+r.c.vacancy,mon:a.mon+(r.c.filled?r.c.monthly:0)}),{cost:0,vac:0,mon:0});
    const pb=(g.personnelBudget!=null&&g.personnelBudget!=='')?+g.personnelBudget:null;
    const gapPos=rows.filter(r=>!r.c.filled&&r.c.gapDays>14);
    const openReq=r=>!['Complete','Declined','Closed','Approved'].includes(r.status);
    body.innerHTML=`
      <div class="card">
        <h2 style="margin-bottom:6px;">1. Legal review</h2>
        <p class="small muted" style="margin-bottom:12px;">Use the CCH Legal &amp; Risk intake form for anything needing legal review. The form opens in a new tab, or fill it in without leaving the app on the App Connection tab. Copy the grant summary below into it, submit, then log it here so the clock and the task are tracked.</p>
        <div class="row" style="display:flex; flex-wrap:wrap; gap:6px 24px; margin-bottom:12px;">${reasons.map((r,i)=>`<label class="check" style="min-width:300px;"><input type="checkbox" id="rq-lr${i}" ${r[1]?'checked':''}> ${esc(r[0])}</label>`).join('')}</div>
        <form class="row" id="legalForm">
          <div class="field" style="flex:3; min-width:300px;"><label>What needs review (document, counterparty, issue)</label><input type="text" id="rq-lneed" required></div>
          <div class="field"><label>Needed by</label><input type="date" id="rq-lby" value="${neededBy}" required></div>
          <div class="field"><label>Smartsheet request # (after submit)</label><input type="text" id="rq-lref"></div>
          <a class="ghost" style="text-decoration:none; padding:8px 12px; border:1px solid var(--border); border-radius:8px; color:var(--ink); font-size:13px;" href="${FORM_LEGAL}" target="_blank" rel="noopener">Open Legal &amp; Risk form ↗</a>
          <button class="ghost" type="button" id="lcopy">Copy request summary</button>
          <button class="primary" type="submit" ${canWrite?'':'disabled'}>Log as submitted</button>
        </form>
        <p class="small muted" style="margin-top:8px;" id="lmsg">Suggested needed-by date = ${contractTask?'the date of "'+esc(contractTask.title)+'" minus '+L.legal+' days':'today plus '+(L.legal+7)+' days'}. Legal turnaround is assumed to be ${L.legal} days (editable on the Board &amp; Lead Times tab).</p>
      </div>

      <div class="card">
        <h2 style="margin-bottom:6px;">2. Staffing budget</h2>
        <p class="small muted" style="margin-bottom:12px;">Every month a position sits vacant after its need-by date is salary the grant does not spend. Enter each position and the app shows the budget in this period and the cost of delay. Fringe defaults to 30% as a placeholder. Replace it with the CCH rate.</p>
        <div class="grid-stats" style="margin-bottom:14px;">
          <div class="stat"><div class="num">${money(tot.cost)}</div><div class="muted small">Personnel cost this budget period</div></div>
          <div class="stat"><div class="num">${money(tot.mon)}</div><div class="muted small">Monthly cost of filled positions</div></div>
          <div class="stat"><div class="num ${tot.vac>0?'bad':''}">${money(tot.vac)}</div><div class="muted small">Unspent so far due to vacancies</div></div>
          <div class="stat"><div class="muted small">Personnel budget line ($)</div><input type="number" id="rq-pb" min="0" step="any" value="${pb!=null?pb:''}" placeholder="From award budget" ${canWrite?'':'disabled'}>${pb!=null?`<div class="small ${tot.cost>pb?'flag-bad':'flag-ok'}">${tot.cost>pb?money(tot.cost-pb)+' over the line':money(pb-tot.cost)+' unallocated'}</div>`:''}</div>
        </div>
        ${rows.length?`<div class="scroll"><table style="min-width:1180px;"><tr><th>Position</th><th>FTE</th><th>Salary ($/yr)</th><th>Fringe %</th><th>Need by</th><th>Expected start</th><th>Status</th><th>Monthly</th><th>Period cost</th><th>Delay</th><th></th></tr>
        ${rows.map(({p,c})=>`<tr>
          <td style="min-width:170px;"><input type="text" class="ps-f" data-id="${esc(p.id)}" data-f="title" value="${esc(p.title||'')}" ${canWrite?'':'disabled'}></td>
          <td style="width:80px; min-width:80px;"><input type="number" class="ps-f" data-id="${esc(p.id)}" data-f="fte" step="any" min="0" value="${esc(p.fte)}" ${canWrite?'':'disabled'}></td>
          <td style="width:120px;"><input type="number" class="ps-f" data-id="${esc(p.id)}" data-f="salary" step="any" min="0" value="${esc(p.salary)}" ${canWrite?'':'disabled'}></td>
          <td style="width:80px;"><input type="number" class="ps-f" data-id="${esc(p.id)}" data-f="fringe" step="any" min="0" value="${p.fringe===''||p.fringe==null?30:esc(p.fringe)}" ${canWrite?'':'disabled'}></td>
          <td style="width:150px;"><input type="date" class="ps-f" data-id="${esc(p.id)}" data-f="needBy" value="${esc(p.needBy||'')}" ${canWrite?'':'disabled'}></td>
          <td style="width:150px;"><input type="date" class="ps-f" data-id="${esc(p.id)}" data-f="start" value="${esc(p.start||'')}" ${canWrite?'':'disabled'}></td>
          <td style="width:150px; min-width:150px;"><select class="ps-f" data-id="${esc(p.id)}" data-f="status" ${canWrite?'':'disabled'}>${POS_STATUS.map(x=>`<option ${p.status===x?'selected':''}>${x}</option>`).join('')}</select></td>
          <td>${money(c.monthly)}</td><td>${money(c.costPeriod)}</td>
          <td class="${c.gapDays>30?'flag-bad':(c.gapDays>14?'flag-warn':'muted')}">${c.filled?'—':(c.gapDays>0?c.gapDays+' d':'—')}${c.vacancy>0?'<div class="small">'+money(c.vacancy)+' unspent</div>':''}</td>
          <td><button class="ghost ps-del" data-id="${esc(p.id)}" ${canWrite?'':'disabled'}>Remove</button></td></tr>`).join('')}
        </table></div>`:'<p class="empty">No positions yet.</p>'}
        <form class="row" id="posForm" style="margin-top:14px; border-top:1px solid var(--border); padding-top:14px;">
          <div class="field" style="flex:2; min-width:200px;"><label>Position title</label><input type="text" id="rq-ptitle" required></div>
          <div class="field" style="min-width:80px;"><label>FTE</label><input type="number" id="rq-pfte" step="any" min="0" value="1"></div>
          <div class="field"><label>Salary ($/yr)</label><input type="number" id="rq-psal" step="any" min="0" value="70000"></div>
          <div class="field" style="min-width:90px;"><label>Fringe %</label><input type="number" id="rq-pfr" step="any" min="0" value="30"></div>
          <div class="field"><label>Need by</label><input type="date" id="rq-pneed"></div>
          <div class="field"><label>Expected start</label><input type="date" id="rq-pstart"></div>
          <button class="primary" type="submit" ${canWrite?'':'disabled'}>Add position</button>
        </form>
      </div>

      <div class="card">
        <h2 style="margin-bottom:6px;">3. Agency staffing</h2>
        <p class="small muted" style="margin-bottom:12px;">When a position will not be filled by its need-by date, an agency bridge can keep the grant spending. Confirm with the funder that agency staff are an allowable cost, and check that the role is covered by the agency staffing categories. The form opens in a new tab.</p>
        ${gapPos.length?`<div class="banner warn" style="margin-bottom:12px;"><b>Gaps worth bridging:</b><br>${gapPos.map(({p,c})=>`${esc(p.title)}: ${c.gapDays} days between need-by and expected start <button class="ghost ag-fill" type="button" data-t="${esc(p.title)}" data-s="${esc(p.needBy||today)}" data-e="${esc(p.start||addDays(today,60))}" style="margin-left:8px;">Prefill bridge below</button>`).join('<br>')}</div>`:''}
        <form class="row" id="agencyForm">
          <div class="field" style="flex:2; min-width:200px;"><label>Role needed</label><input type="text" id="rq-arole" required></div>
          <div class="field" style="min-width:90px;"><label>Hours / week</label><input type="number" id="rq-ahrs" min="0" step="any" value="40"></div>
          <div class="field" style="min-width:110px;"><label>Bill rate ($/hr)</label><input type="number" id="rq-arate" min="0" step="any" value="0"></div>
          <div class="field"><label>Start</label><input type="date" id="rq-astart" required></div>
          <div class="field"><label>End</label><input type="date" id="rq-aend" required></div>
          <div class="field"><label>Reason</label><select id="rq-areason"><option>Unfilled Job Positions</option><option>LOA (Sick Leave and FMLA)</option><option>PTO</option><option>Other</option></select></div>
          <div class="field"><label>Smartsheet request # (after submit)</label><input type="text" id="rq-aref"></div>
          <a class="ghost" style="text-decoration:none; padding:8px 12px; border:1px solid var(--border); border-radius:8px; color:var(--ink); font-size:13px;" href="${FORM_AGENCY}" target="_blank" rel="noopener">Open Agency Staffing form ↗</a>
          <button class="ghost" type="button" id="acopy">Copy request summary</button>
          <button class="primary" type="submit" ${canWrite?'':'disabled'}>Log as submitted</button>
        </form>
        <p class="small muted" style="margin-top:8px;" id="amsg">Estimated agency cost: <b id="acost">$0</b>. The first shift is assumed to be about ${L.agency} days after the request is approved.</p>
      </div>

      <div class="card">
        <h2 style="margin-bottom:6px;">Request log</h2>
        ${reqs.length?`<div class="scroll"><table><tr><th>Type</th><th>Request</th><th>Needed by</th><th>Submitted</th><th>Ref #</th><th>Status</th><th></th></tr>
        ${reqs.map(r=>{ const age=r.submittedAt?diffDays(r.submittedAt,today):0; const late=openReq(r)&&age>14; return `<tr>
          <td><span class="pill ${r.type==='Legal'?'grey':'yellow'}">${esc(r.type)}</span></td>
          <td style="min-width:260px;">${esc(r.summary||'')}${r.estCost?'<div class="small muted">Est. agency cost '+money(r.estCost)+'</div>':''}</td>
          <td>${fd(r.neededBy)}</td>
          <td>${fd(r.submittedAt)}${openReq(r)?'<div class="small '+(late?'flag-bad':'muted')+'">'+age+' days waiting</div>':''}</td>
          <td>${esc(r.ref||'—')}</td>
          <td><select class="rq-status" data-id="${esc(r.id)}" ${canWrite?'':'disabled'}>${REQ_STATUS.map(x=>`<option ${r.status===x?'selected':''}>${x}</option>`).join('')}</select></td>
          <td><button class="ghost rq-del" data-id="${esc(r.id)}" ${canWrite?'':'disabled'}>Remove</button></td></tr>`; }).join('')}
        </table></div>`:'<p class="empty">No requests logged for this grant.</p>'}
      </div>`;
    Object.keys(keep).forEach(id=>{ const el=$(id); if(el){ if(el.type==='checkbox') el.checked=keep[id]; else if(keep[id]!=='') el.value=keep[id]; } });
    const checked=()=>reasons.filter((r,i)=>$('rq-lr'+i).checked).map(r=>r[0]);
    $('lcopy').addEventListener('click',()=>copyText(reqSummary(g,'Legal',['Review needed: '+($('rq-lneed').value||'(describe)'),'Reason(s): '+(checked().join('; ')||'—'),'Needed by: '+fd($('rq-lby').value),'Related dated tasks: '+(contractTask?contractTask.title+' ('+fd(contractTask.due)+')':'—')]),$('lmsg')));
    $('legalForm').addEventListener('submit',async e=>{
      e.preventDefault(); if(!db||!canWrite) return;
      const need=$('rq-lneed').value.trim(), by=$('rq-lby').value; if(!need||!by) return;
      try{
        await db.collection('requests').add({grantId:g.id,type:'Legal',summary:need+(checked().length?' ('+checked().join('; ')+')':''),neededBy:by,submittedAt:today,ref:$('rq-lref').value.trim(),status:'Submitted'});
        await db.collection('tasks').add({grantId:g.id,track:'Subrecipients',title:'Legal review: '+need,owner:'CCH Legal',due:by,gate:true,done:false,doneAt:''});
        $('rq-lneed').value=''; $('rq-lref').value='';
      }catch(x){console.error(x);}
    });
    $('rq-pb').addEventListener('change',e=>updateGrant(g.id,{personnelBudget:e.target.value===''?null:Math.max(0,parseFloat(e.target.value)||0)}));
    body.querySelectorAll('.ps-f').forEach(el=>el.addEventListener('change',async()=>{
      if(!canWrite) return; const f=el.dataset.f; let v=el.value; if(['fte','salary','fringe'].includes(f)) v=parseFloat(v)||0;
      try{ await db.collection('positions').doc(el.dataset.id).update({[f]:v}); }catch(x){console.error(x);} }));
    body.querySelectorAll('.ps-del').forEach(b=>b.addEventListener('click',async()=>{ if(!canWrite) return; try{await db.collection('positions').doc(b.dataset.id).delete();}catch(x){console.error(x);} }));
    $('posForm').addEventListener('submit',async e=>{
      e.preventDefault(); if(!db||!canWrite) return;
      try{ await db.collection('positions').add({grantId:g.id,title:$('rq-ptitle').value.trim(),fte:parseFloat($('rq-pfte').value)||0,salary:parseFloat($('rq-psal').value)||0,fringe:parseFloat($('rq-pfr').value)||0,needBy:$('rq-pneed').value||'',start:$('rq-pstart').value||'',status:'Planned'}); $('rq-ptitle').value=''; }
      catch(x){console.error(x);}
    });
    const upd=()=>{ const h=parseFloat($('rq-ahrs').value)||0, r=parseFloat($('rq-arate').value)||0, s=$('rq-astart').value, en=$('rq-aend').value;
      const wk=(s&&en&&en>=s)?(diffDays(s,en)+1)/7:0; const cost=h*r*wk; $('acost').textContent=money(cost); return cost; };
    ['rq-ahrs','rq-arate','rq-astart','rq-aend'].forEach(id=>$(id).addEventListener('input',upd)); upd();
    body.querySelectorAll('.ag-fill').forEach(b=>b.addEventListener('click',()=>{ $('rq-arole').value=b.dataset.t; $('rq-astart').value=b.dataset.s; $('rq-aend').value=b.dataset.e; upd(); }));
    $('acopy').addEventListener('click',()=>copyText(reqSummary(g,'Agency',['Role: '+($('rq-arole').value||'(role)'),'Hours per week: '+$('rq-ahrs').value,'Dates: '+fd($('rq-astart').value)+' to '+fd($('rq-aend').value),'Reason: '+$('rq-areason').value,'Estimated agency cost: '+$('acost').textContent]),$('amsg')));
    $('agencyForm').addEventListener('submit',async e=>{
      e.preventDefault(); if(!db||!canWrite) return;
      const role=$('rq-arole').value.trim(), s=$('rq-astart').value, en=$('rq-aend').value; if(!role||!s||!en) return;
      const cost=upd();
      try{
        await db.collection('requests').add({grantId:g.id,type:'Agency staffing',summary:role+' · '+$('rq-ahrs').value+' hrs/wk · '+fd(s)+' to '+fd(en)+' · '+$('rq-areason').value,neededBy:s,submittedAt:today,ref:$('rq-aref').value.trim(),status:'Submitted',estCost:Math.round(cost)});
        await db.collection('tasks').add({grantId:g.id,track:'Hiring',title:'Agency staffing bridge: '+role,owner:'Program Manager',due:s,gate:false,done:false,doneAt:''});
        $('rq-arole').value=''; $('rq-aref').value='';
      }catch(x){console.error(x);}
    });
    body.querySelectorAll('.rq-status').forEach(sel2=>sel2.addEventListener('change',async e=>{ if(!canWrite) return; try{await db.collection('requests').doc(sel2.dataset.id).update({status:e.target.value});}catch(x){console.error(x);} }));
    body.querySelectorAll('.rq-del').forEach(b=>b.addEventListener('click',async()=>{ if(!canWrite) return; try{await db.collection('requests').doc(b.dataset.id).delete();}catch(x){console.error(x);} }));
  }


  // ================= GENERIC HELPERS (forms, editable tables) =================
  const FORMS={};
  const FREQ_M={Monthly:1,Quarterly:3,Semiannual:6,Annual:12};
  const FREQS=['One-time','Monthly','Quarterly','Semiannual','Annual'];
  const CATS=['Personnel','Fringe','Contractual / subrecipients','Supplies','Equipment','Travel','Training','Other direct','Indirect'];
  const NOT_BASE=new Set(['Equipment','Contractual / subrecipients','Indirect']);
  const noGrant='<div class="card"><p class="empty">No grant selected. Add one on the New Award tab.</p></div>';
  const stat=(num,label,cls)=>`<div class="stat"><div class="num ${cls||''}">${num}</div><div class="muted small">${label}</div></div>`;
  const forGrant=(arr,g)=>arr.filter(x=>x.grantId===g.id);
  const gname=id=>{ const g=grants.find(x=>x.id===id); return g?g.name:'—'; };
  const timing=(due,done)=>{ if(!due||done) return ''; const d=diffDays(today,due); return d<0?`<div class="small flag-bad">${Math.abs(d)}d overdue</div>`:(d<=14?`<div class="small flag-warn">in ${d}d</div>`:`<div class="small muted">in ${d}d</div>`); };

  function fieldHTML(f,idp){
    const id=idp+'-'+f.n; const st='flex:'+(f.w||1)+'; min-width:'+(f.mw||130)+'px;';
    if(f.t==='check') return `<label class="check" style="min-width:${f.mw||200}px;"><input type="checkbox" id="${id}" name="${f.n}" ${f.v?'checked':''}> ${esc(f.l)}</label>`;
    let input;
    if(f.t==='select') input=`<select id="${id}" name="${f.n}">${f.opts.map(o=>`<option ${String(o)===String(f.v)?'selected':''}>${esc(o)}</option>`).join('')}</select>`;
    else input=`<input type="${f.t||'text'}" id="${id}" name="${f.n}" ${f.t==='number'?'step="any" min="0"':''} ${f.list?'list="'+f.list+'"':''} value="${f.v!=null?esc(f.v):''}" ${f.req?'required':''}>`;
    return `<div class="field" style="${st}"><label>${esc(f.l)}</label>${input}</div>`;
  }
  function formHTML(formId,fields,btn){
    return `<form class="row cform" id="${formId}" data-form="${formId}">${fields.map(f=>fieldHTML(f,formId)).join('')}<button class="primary" type="submit" ${canWrite?'':'disabled'}>${btn}</button></form>`;
  }
  function cellInput(coll,r,c){
    const v=r[c.f];
    const attrs=`class="cf" data-coll="${coll}" data-id="${esc(r.id)}" data-f="${c.f}" data-t="${c.t||'text'}" ${canWrite?'':'disabled'}`;
    if(c.t==='select') return `<select ${attrs}>${(v&&!c.opts.includes(v)?[v]:[]).concat(c.opts).map(o=>`<option ${String(v)===String(o)?'selected':''}>${esc(o)}</option>`).join('')}</select>`;
    if(c.t==='check') return `<input type="checkbox" ${attrs} ${v?'checked':''}>`;
    return `<input type="${c.t||'text'}" ${attrs} value="${v==null?'':esc(v)}" ${c.t==='number'?'step="any" min="0"':''}>`;
  }
  function tableHTML(coll,rows,cols,minw){
    if(!rows.length) return '<p class="empty">Nothing here yet.</p>';
    const head=cols.map(c=>`<th>${c.l}</th>`).join('')+'<th></th>';
    const body=rows.map(r=>'<tr>'+cols.map(c=>c.calc?`<td>${c.calc(r)}</td>`:`<td style="${c.w?'min-width:'+c.w+'px;':''}">${cellInput(coll,r,c)}</td>`).join('')+`<td><button class="ghost cdel" data-coll="${coll}" data-id="${esc(r.id)}" ${canWrite?'':'disabled'}>Remove</button></td></tr>`).join('');
    return `<div class="scroll"><table style="min-width:${minw||900}px;"><tr>${head}</tr>${body}</table></div>`;
  }
  function renderInto(el,html){
    const keep={}; el.querySelectorAll('form.cform [id]').forEach(x=>{ keep[x.id]=x.type==='checkbox'?x.checked:x.value; });
    const act=document.activeElement; const actId=act&&act.id&&el.contains(act)?act.id:null;
    el.innerHTML=html;
    Object.keys(keep).forEach(id=>{ const x=$(id); if(x){ if(x.type==='checkbox') x.checked=keep[id]; else if(keep[id]!=='') x.value=keep[id]; } });
    if(actId&&$(actId)&&$(actId).focus) $(actId).focus();
  }
  async function logAct(gid,text){
    if(!db||!canWrite) return;
    try{ await db.collection('activity').add({ts:new Date().toISOString(),user:myId?myId.slice(0,8):'',grantId:gid||'',text}); }catch(e){}
  }
  document.addEventListener('submit',async e=>{
    const f=e.target; if(!f.classList||!f.classList.contains('cform')) return;
    e.preventDefault(); const cfg=FORMS[f.dataset.form]; if(!cfg||!db||!canWrite) return;
    const vals={}; f.querySelectorAll('[name]').forEach(el=>{ vals[el.name]=el.type==='checkbox'?el.checked:(el.type==='number'?(el.value===''?null:parseFloat(el.value)):el.value.trim()); });
    try{ const doc=cfg.build(vals); if(!doc) return; const ref=await db.collection(cfg.coll).add(doc);
      if(cfg.after) await cfg.after(doc,ref); if(cfg.log) logAct(doc.grantId||'',cfg.log(doc)); f.reset(); }catch(x){ console.error(x); }
  });
  document.addEventListener('change',async e=>{
    const t=e.target;
    if(t.id==='osel'){ osel=t.value; renderApplication(); return; }
    if(!t.classList||!t.classList.contains('cf')||!db||!canWrite) return;
    const ty=t.dataset.t; let v; if(ty==='check') v=t.checked; else if(ty==='number') v=t.value===''?null:Math.max(0,parseFloat(t.value)||0); else v=t.value;
    try{ await db.collection(t.dataset.coll).doc(t.dataset.id).update({[t.dataset.f]:v}); }catch(x){ console.error(x); }
  });
  document.addEventListener('click',async e=>{
    const el=e.target; if(!el.closest) return;
    const del=el.closest('.cdel');
    if(del){ if(!db||!canWrite) return; try{ await db.collection(del.dataset.coll).doc(del.dataset.id).delete(); }catch(x){ console.error(x); } return; }
    const rs=el.closest('.rpt-submit');
    if(rs){ if(!db||!canWrite) return; const r=reports.find(x=>x.id===rs.dataset.id); if(!r) return;
      try{ await db.collection('reports').doc(r.id).update({status:'Submitted',submittedAt:today});
        if(FREQ_M[r.freq]&&r.due){ await db.collection('reports').add({grantId:r.grantId,name:r.name,freq:r.freq,due:addMonthsISO(r.due,FREQ_M[r.freq]),owner:r.owner||'',status:'Not started',submittedAt:''}); }
        logAct(r.grantId,'Submitted report: '+r.name); }catch(x){ console.error(x); } return; }
    const oc=el.closest('.opp-convert');
    if(oc){ const o=opps.find(x=>x.id===oc.dataset.id); if(!o) return; startAwardFromOpp(o); return; }
    const oo=el.closest('.opp-open');
    if(oo){ osel=oo.dataset.id; renderApplication(); setTab('application'); return; }
    const tp=el.closest('.tpl-apply');
    if(tp){ $('in-template').value=tp.dataset.id; applyTemplate(); setTab('intake'); return; }
    const cs=el.closest('#closeAdd');
    if(cs){ const g=grants.find(x=>x.id===sel); if(g&&db&&canWrite){ await addMissingTasks(g.id,closeoutItems(g)); logAct(g.id,'Added closeout checklist'); } return; }
    const bs=el.closest('#bd-std');
    if(bs){ const g=grants.find(x=>x.id===sel); if(g&&db&&canWrite){ for(const c of CATS){ await db.collection('budgetlines').add({grantId:g.id,category:c,approved:0,current:0,expended:0,encumbered:0,inBase:!NOT_BASE.has(c),note:''}); } logAct(g.id,'Created standard budget lines'); } return; }
  });
  document.addEventListener('change',async e=>{
    const t=e.target; if(!t.classList||!db||!canWrite) return;
    if(t.classList.contains('gf')){ // grant field
      const g=grants.find(x=>x.id===sel); if(!g) return; let v=t.value; if(t.dataset.t==='number') v=v===''?null:Math.max(0,parseFloat(v)||0);
      try{ await db.collection('grants').doc(g.id).update({[t.dataset.f]:v}); }catch(x){ console.error(x); } return; }
    if(t.classList.contains('ap-f')){
      const o=opps.find(x=>x.id===t.dataset.id); if(!o) return; const a=JSON.parse(JSON.stringify(o.approvals||{})); const role=t.dataset.role;
      a[role]=a[role]||{name:'',status:'Pending',date:''}; a[role][t.dataset.f]=t.value; if(t.dataset.f==='status'&&t.value==='Approved'&&!a[role].date) a[role].date=today;
      try{ await db.collection('opps').doc(o.id).update({approvals:a}); }catch(x){ console.error(x); } return; }
    if(t.classList.contains('ob-f')){
      const o=opps.find(x=>x.id===t.dataset.id); if(!o) return;
      try{ if(t.dataset.cat==='__rate') await db.collection('opps').doc(o.id).update({orate:t.value===''?null:Math.max(0,parseFloat(t.value)||0)});
        else{ const b=JSON.parse(JSON.stringify(o.obudget||{})); b[t.dataset.cat]=Math.max(0,parseFloat(t.value)||0); await db.collection('opps').doc(o.id).update({obudget:b}); } }catch(x){ console.error(x); } return; }
    if(t.classList.contains('burn-f')){
      const next=Object.assign({},burn()); next[t.dataset.k]=Math.max(0,parseFloat(t.value)||0);
      try{ await db.collection('settings').doc('burn').set(next); }catch(x){ console.error(x); } return; }
  });

  // ================= PHASE 3 · POST-AWARD =================
  // ---- Budget ----
  function renderBudget(){
    const el=$('budgetBody'); const g=grants.find(x=>x.id===sel); if(!g){ el.innerHTML=noGrant; return; }
    const rows=forGrant(budgetlines,g).sort((a,b)=>CATS.indexOf(a.category)-CATS.indexOf(b.category));
    const sum=k=>rows.reduce((s,r)=>s+(+r[k]||0),0);
    const cur=sum('current'), exp=sum('expended'), enc=sum('encumbered'), avail=cur-exp-enc;
    const transfers=rows.reduce((s,r)=>s+Math.max(0,(+r.current||0)-(+r.approved||0)),0);
    const tPct=g.amount?transfers/g.amount*100:0;
    const thr=(g.rebudgetPct!=null&&g.rebudgetPct!=='')?+g.rebudgetPct:null;
    const rate=(g.indirectRate!=null&&g.indirectRate!=='')?+g.indirectRate:null;
    const base=rows.filter(r=>r.inBase&&r.category!=='Indirect').reduce((s,r)=>s+(+r.expended||0),0);
    const indLine=rows.find(r=>r.category==='Indirect'); const expInd=rate!=null?base*rate/100:null;
    const m=baseMetrics(g);
    const msgs=[];
    if(rows.length&&g.spentToDate!=null&&g.spentToDate!==''&&exp>0&&Math.abs(exp-g.spentToDate)>1) msgs.push(['warn','Budget lines show '+money(exp)+' expended, but Spent to date is '+money(g.spentToDate)+'. Reconcile them.']);
    if(rows.length&&cur>0&&Math.abs(cur-g.amount)>1&&Math.abs(cur-periodBudgetOf(g))>1) msgs.push(['warn','Current budget lines total '+money(cur)+'. The award is '+money(g.amount)+' (this budget period: about '+money(periodBudgetOf(g))+').']);
    if(thr!=null&&tPct>=thr) msgs.push(['bad','Cumulative transfers between lines are '+tPct.toFixed(1)+'% of the award, at or above the '+thr+'% rebudget threshold you entered. Funder approval may be required. Log a rebudget on the Amendments tab.']);
    else if(thr==null&&rows.length) msgs.push(['warn','Enter the funder\'s rebudget threshold (from the award terms) so the app can warn you before a transfer needs approval.']);
    if(expInd!=null&&indLine&&Math.abs((+indLine.expended||0)-expInd)>Math.max(500,expInd*0.05)) msgs.push(['warn','Indirect expended is '+money(indLine.expended||0)+', but '+rate+'% of the base ('+money(base)+') is '+money(expInd)+'.']);
    const cols=[
      {f:'category',l:'Category',t:'select',opts:CATS,w:190},
      {f:'approved',l:'Approved ($)',t:'number',step:100,w:110},
      {f:'current',l:'Current plan ($)',t:'number',step:100,w:110},
      {f:'expended',l:'Expended ($)',t:'number',step:100,w:110},
      {f:'encumbered',l:'Encumbered ($)',t:'number',step:100,w:110},
      {l:'Available',calc:r=>{ const a=(+r.current||0)-(+r.expended||0)-(+r.encumbered||0); return `<span class="${a<0?'flag-bad':''}">${money(a)}</span>`; }},
      {l:'% spent',calc:r=>{ const c=+r.current||0; if(!c) return '—'; const p=(+r.expended||0)/c*100; const cls=p>100?'flag-bad':(p<m.tEl*100-20?'flag-warn':''); return `<span class="${cls}">${Math.round(p)}%</span>`; }},
      {f:'inBase',l:'In indirect base',t:'check'},
      {f:'note',l:'Allowable-use note',w:200}
    ];
    FORMS['f-bl']={coll:'budgetlines',log:d=>'Added budget line: '+d.category,build:v=>({grantId:g.id,category:v.category,approved:v.approved||0,current:v.current!=null?v.current:(v.approved||0),expended:v.expended||0,encumbered:v.encumbered||0,inBase:!NOT_BASE.has(v.category),note:''})};
    renderInto(el,`
      <div class="grid-stats">
        ${stat(money(g.amount),'Total award')}${stat(money(cur),'Current plan (all lines)')}${stat(money(exp),'Expended')}${stat(money(enc),'Encumbered (committed)')}${stat(money(avail),'Available',avail<0?'bad':'')}
      </div>
      ${msgs.map(x=>`<div class="banner ${x[0]}">${esc(x[1])}</div>`).join('')}
      <div class="card"><h2 style="margin-bottom:6px;">Budget by category</h2>
        <p class="small muted" style="margin-bottom:12px;">Approved is the budget in the award. Current plan is after any rebudgets. Transfers are tracked as the total of increases over approved. Allowable uses and rebudget limits vary by funder, so the thresholds below are yours to enter from the award terms.</p>
        <div class="row" style="display:flex; gap:12px; flex-wrap:wrap; margin-bottom:14px;">
          <div class="field" style="min-width:230px;"><label>Rebudget approval threshold (% of award, from award terms)</label><input type="number" class="gf" data-f="rebudgetPct" data-t="number" step="any" min="0" value="${thr!=null?thr:''}" ${canWrite?'':'disabled'}></div>
          <div class="field" style="min-width:230px;"><label>Indirect rate (%, negotiated or de minimis that applies)</label><input type="number" class="gf" data-f="indirectRate" data-t="number" step="any" min="0" value="${rate!=null?rate:''}" ${canWrite?'':'disabled'}></div>
          <div class="stat" style="min-width:200px;"><div class="muted small">Transfers vs. approved</div><div class="num" style="font-size:22px;">${money(transfers)}</div><div class="small muted">${tPct.toFixed(1)}% of award</div></div>
          ${expInd!=null?`<div class="stat" style="min-width:200px;"><div class="muted small">Indirect expected on base</div><div class="num" style="font-size:22px;">${money(expInd)}</div><div class="small muted">base ${money(base)}</div></div>`:''}
        </div>
        ${rows.length?tableHTML('budgetlines',rows,cols,1150):'<p class="empty">No budget lines yet.</p><button class="ghost" id="bd-std" '+(canWrite?'':'disabled')+'>Create the standard categories</button>'}
        <h3 style="margin:18px 0 10px;">Add a line</h3>
        ${formHTML('f-bl',[{n:'category',l:'Category',t:'select',opts:CATS,w:2},{n:'approved',l:'Approved ($)',t:'number',step:100},{n:'current',l:'Current ($, blank = approved)',t:'number',step:100},{n:'expended',l:'Expended ($)',t:'number',step:100},{n:'encumbered',l:'Encumbered ($)',t:'number',step:100}],'Add line')}
      </div>`);
  }

  // ---- Invoices & drawdowns ----
  function renderCash(){
    const el=$('cashBody'); const g=grants.find(x=>x.id===sel); if(!g){ el.innerHTML=noGrant; return; }
    const m=baseMetrics(g);
    const inv=forGrant(invoices,g).sort((a,b)=>(b.invDate||'').localeCompare(a.invDate||''));
    const dd=forGrant(drawdowns,g).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
    const recvd=dd.filter(d=>['Paid','Reconciled'].includes(d.status)).reduce((s,d)=>s+(+d.amount||0),0);
    const pend=dd.filter(d=>['Prepared','Submitted'].includes(d.status)).reduce((s,d)=>s+(+d.amount||0),0);
    const gap=Math.max(0,m.actual-recvd);
    const old=inv.filter(i=>!['Posted','Paid'].includes(i.status)&&i.receivedDate&&diffDays(i.receivedDate,today)>30).length;
    const subNames=forGrant(subs,g).map(x=>x.name);
    const icols=[
      {f:'party',l:'Vendor / subrecipient',w:170},{f:'invoiceNo',l:'Invoice #',w:100},{f:'amount',l:'Amount ($)',t:'number',step:100,w:110},
      {f:'invDate',l:'Invoice date',t:'date',w:140},{f:'receivedDate',l:'Received',t:'date',w:140},
      {f:'status',l:'Status',t:'select',opts:['Received','Approved','Posted','Paid'],w:120},
      {l:'Not posted for',calc:i=>{ if(['Posted','Paid'].includes(i.status)||!i.receivedDate) return '—'; const d=diffDays(i.receivedDate,today); return `<span class="${d>30?'flag-bad':(d>14?'flag-warn':'')}">${d} days</span>`; }},
      {f:'note',l:'Note',w:160}];
    const dcols=[
      {f:'date',l:'Date',t:'date',w:140},{f:'amount',l:'Amount ($)',t:'number',step:100,w:120},
      {f:'method',l:'Method',t:'select',opts:['HHS PMS','State portal','Voucher / reimbursement','Other'],w:170},
      {f:'status',l:'Status',t:'select',opts:['Prepared','Submitted','Paid','Reconciled'],w:130},{f:'note',l:'Note',w:200}];
    FORMS['f-inv']={coll:'invoices',log:d=>'Logged invoice '+(d.invoiceNo||'')+' from '+d.party,build:v=>v.party&&v.amount!=null?{grantId:g.id,party:v.party,invoiceNo:v.invoiceNo,amount:v.amount,invDate:v.invDate,receivedDate:v.receivedDate||today,status:v.status,note:''}:null};
    FORMS['f-dd']={coll:'drawdowns',log:d=>'Logged drawdown '+money(d.amount),build:v=>v.amount!=null?{grantId:g.id,date:v.date||today,amount:v.amount,method:v.method,status:v.status,note:''}:null};
    renderInto(el,`
      <div class="grid-stats">
        ${stat(money(m.posted),'Posted spend')}${stat(money(m.accrued),'Invoices not yet posted',m.accrued>0?'bad':'')}${stat(money(m.actual),'Adjusted spend (posted + unposted)')}${stat(money(recvd),'Drawn and received')}${stat(money(gap),'Spent but not yet received')}
      </div>
      ${old?`<div class="banner warn">${old} invoice${old>1?'s have':' has'} been waiting more than 30 days to post. Unposted invoices make spend look lower than it is, and a late invoice near the end of an award can become unpayable.</div>`:''}
      <div class="card"><h2 style="margin-bottom:6px;">Invoices</h2>
        <p class="small muted" style="margin-bottom:12px;">Log every vendor and subrecipient invoice the day it arrives. Anything not yet Posted or Paid counts toward adjusted spend, which drives the pace check and the lapse projection.</p>
        ${tableHTML('invoices',inv,icols,1150)}
        <datalist id="partyList">${subNames.map(n=>`<option value="${esc(n)}">`).join('')}</datalist>
        <h3 style="margin:18px 0 10px;">Log an invoice</h3>
        ${formHTML('f-inv',[{n:'party',l:'Vendor / subrecipient',list:'partyList',w:2,req:true},{n:'invoiceNo',l:'Invoice #'},{n:'amount',l:'Amount ($)',t:'number',step:100,req:true},{n:'invDate',l:'Invoice date',t:'date'},{n:'receivedDate',l:'Received',t:'date',v:today},{n:'status',l:'Status',t:'select',opts:['Received','Approved','Posted','Paid']}],'Log invoice')}
      </div>
      <div class="card"><h2 style="margin-bottom:6px;">Drawdowns and reimbursements</h2>
        <p class="small muted" style="margin-bottom:12px;">The funder's system makes the actual draw. This log tracks what was requested, what arrived, and whether it reconciles to Oracle. Pending requests: ${money(pend)}.</p>
        ${tableHTML('drawdowns',dd,dcols,900)}
        <h3 style="margin:18px 0 10px;">Log a drawdown</h3>
        ${formHTML('f-dd',[{n:'date',l:'Date',t:'date',v:today},{n:'amount',l:'Amount ($)',t:'number',step:100,req:true},{n:'method',l:'Method',t:'select',opts:['HHS PMS','State portal','Voucher / reimbursement','Other'],w:2},{n:'status',l:'Status',t:'select',opts:['Prepared','Submitted','Paid','Reconciled']}],'Log drawdown')}
      </div>`);
  }

  // ---- Time & effort ----
  function effortLatest(){
    const best={}; timeeffort.forEach(t=>{ const k=(t.staff||'').trim().toLowerCase()+'|'+t.grantId; if(!best[k]||(t.due||'')>(best[k].due||'')) best[k]=t; });
    const byStaff={}; Object.values(best).forEach(t=>{ const k=(t.staff||'').trim().toLowerCase(); if(!k) return; (byStaff[k]=byStaff[k]||{name:t.staff,total:0,parts:[]}); byStaff[k].total+=+t.pct||0; byStaff[k].parts.push(gname(t.grantId)+' '+(+t.pct||0)+'%'); });
    return Object.values(byStaff).filter(x=>x.total>100).sort((a,b)=>b.total-a.total);
  }
  function renderEffort(){
    const el=$('effortBody'); const g=grants.find(x=>x.id===sel); if(!g){ el.innerHTML=noGrant; return; }
    const rows=forGrant(timeeffort,g).sort((a,b)=>(a.due||'').localeCompare(b.due||''));
    const late=rows.filter(t=>t.status!=='Certified'&&t.due&&t.due<today).length;
    const soon=rows.filter(t=>t.status!=='Certified'&&t.due&&diffDays(today,t.due)>=0&&diffDays(today,t.due)<=30).length;
    const cert=rows.filter(t=>t.status==='Certified').length;
    const over=effortLatest();
    const cols=[
      {f:'staff',l:'Staff member',w:170},{f:'role',l:'Role',w:150},{f:'pct',l:'% on this grant',t:'number',step:5,w:90},{f:'period',l:'Certification period',w:150},
      {f:'due',l:'Due',t:'date',w:140},{f:'status',l:'Status',t:'select',opts:['Not sent','Sent','Certified','Late'],w:120},{f:'certifiedAt',l:'Certified on',t:'date',w:140},
      {l:'Timing',calc:t=>t.status==='Certified'?'<span class="flag-ok">Done</span>':(timing(t.due)||'—')}];
    FORMS['f-te']={coll:'timeeffort',log:d=>'Added T&E entry for '+d.staff,build:v=>v.staff?{grantId:g.id,staff:v.staff,role:v.role,pct:v.pct||0,period:v.period,due:v.due,status:'Not sent',certifiedAt:''}:null};
    renderInto(el,`
      <div class="grid-stats">${stat(rows.length,'Entries on this grant')}${stat(cert,'Certified')}${stat(late,'Overdue',late?'bad':'')}${stat(soon,'Due in 30 days')}</div>
      ${over.length?`<div class="banner bad"><b>Staff allocated over 100% across grants:</b><br>${over.map(x=>esc(x.name)+': '+x.total+'% ('+esc(x.parts.join(', '))+')').join('<br>')}</div>`:''}
      <div class="card"><h2 style="margin-bottom:6px;">Time &amp; effort certifications</h2>
        <p class="small muted" style="margin-bottom:12px;">Every staff member paid from this grant, the share of their time charged to it, and the certification status. Existing-staff allocations go to the T&amp;E certification mailbox per your process map. Certification schedules differ by funder, so set the period and due date from the award terms.</p>
        ${tableHTML('timeeffort',rows,cols,1050)}
        <h3 style="margin:18px 0 10px;">Add an entry</h3>
        ${formHTML('f-te',[{n:'staff',l:'Staff member',w:2,req:true},{n:'role',l:'Role',w:1.5},{n:'pct',l:'% on this grant',t:'number',step:5,v:100},{n:'period',l:'Certification period',w:1.5},{n:'due',l:'Due',t:'date'}],'Add entry')}
      </div>`);
  }

  // ---- Reports & performance ----
  function renderReports(){
    const el=$('reportsBody'); const g=grants.find(x=>x.id===sel); if(!g){ el.innerHTML=noGrant; return; }
    const m=baseMetrics(g);
    const rows=forGrant(reports,g).sort((a,b)=>(a.due||'9').localeCompare(b.due||'9'));
    const openAll=reports.filter(r=>!['Submitted','Accepted'].includes(r.status)&&r.due&&diffDays(today,r.due)<=45).sort((a,b)=>a.due.localeCompare(b.due));
    const ms=forGrant(measures,g);
    const rcols=[
      {f:'name',l:'Report or voucher',w:210},{f:'freq',l:'Frequency',t:'select',opts:FREQS,w:120},{f:'due',l:'Due',t:'date',w:140},{f:'owner',l:'Owner',w:130},
      {f:'status',l:'Status',t:'select',opts:['Not started','Drafting','Sponsor review','Submitted','Accepted'],w:140},
      {l:'Timing',calc:r=>['Submitted','Accepted'].includes(r.status)?'<span class="flag-ok">'+(r.submittedAt?fd(r.submittedAt):'Done')+'</span>':(timing(r.due)||'—')},
      {l:'',calc:r=>['Submitted','Accepted'].includes(r.status)?'':`<button class="ghost rpt-submit" data-id="${esc(r.id)}" ${canWrite?'':'disabled'}>Mark submitted${FREQ_M[r.freq]?' and schedule next':''}</button>`}];
    const mcols=[
      {f:'name',l:'Measure',w:220},{f:'unit',l:'Unit',w:90},{f:'target',l:'Target',t:'number',step:1,w:100},{f:'actual',l:'Actual',t:'number',step:1,w:100},{f:'period',l:'Period',w:130},
      {l:'Progress',calc:x=>{ const t=+x.target||0; if(!t) return '—'; const p=(+x.actual||0)/t*100; const beh=p<m.tEl*100-20; return `<div class="bar-track"><div class="bar-seg" style="width:${Math.min(100,p)}%; background:${beh?'#b3432b':'#3f7a53'};"></div></div><div class="small ${beh?'flag-bad':'muted'}">${Math.round(p)}% of target${beh?' (behind award time)':''}</div>`; }},
      {f:'note',l:'Note',w:180}];
    FORMS['f-rep']={coll:'reports',log:d=>'Added report: '+d.name,build:v=>v.name?{grantId:g.id,name:v.name,freq:v.freq,due:v.due,owner:v.owner,status:'Not started',submittedAt:''}:null};
    FORMS['f-ms']={coll:'measures',log:d=>'Added performance measure: '+d.name,build:v=>v.name?{grantId:g.id,name:v.name,unit:v.unit,target:v.target||0,actual:v.actual||0,period:v.period,note:''}:null};
    renderInto(el,`
      <div class="card"><h2 style="margin-bottom:6px;">Due across all grants (next 45 days and overdue)</h2>
        ${openAll.length?'<div class="scroll"><table><tr><th>Due</th><th>Report</th><th>Grant</th><th>Owner</th><th>Status</th></tr>'+openAll.slice(0,25).map(r=>`<tr><td>${fd(r.due)}${timing(r.due)}</td><td>${esc(r.name)}</td><td class="muted">${esc(gname(r.grantId))}</td><td class="muted">${esc(r.owner||'Unassigned')}</td><td>${esc(r.status)}</td></tr>`).join('')+'</table></div>':'<p class="empty">Nothing due in the next 45 days.</p>'}
      </div>
      <div class="card"><h2 style="margin-bottom:6px;">Reporting calendar: ${esc(g.name)}</h2>
        <p class="small muted" style="margin-bottom:12px;">Marking a recurring report submitted creates the next one automatically. Draft each report about 10 business days before it is due so sponsor review has time.</p>
        ${tableHTML('reports',rows,rcols,1150)}
        <h3 style="margin:18px 0 10px;">Add a report or voucher</h3>
        ${formHTML('f-rep',[{n:'name',l:'Report or voucher',w:2,req:true},{n:'freq',l:'Frequency',t:'select',opts:FREQS},{n:'due',l:'First due date',t:'date',req:true},{n:'owner',l:'Owner'}],'Add report')}
      </div>
      <div class="card"><h2 style="margin-bottom:6px;">Performance measures</h2>
        <p class="small muted" style="margin-bottom:12px;">Copy the measures and targets from the award. Funders hold CCH to the award's deliverables, not to spending alone.</p>
        ${tableHTML('measures',ms,mcols,1100)}
        <h3 style="margin:18px 0 10px;">Add a measure</h3>
        ${formHTML('f-ms',[{n:'name',l:'Measure',w:2,req:true},{n:'unit',l:'Unit'},{n:'target',l:'Target',t:'number'},{n:'actual',l:'Actual to date',t:'number'},{n:'period',l:'Period'}],'Add measure')}
      </div>`);
  }

  // ---- Subrecipients ----
  function renderSubs(){
    const el=$('subsBody'); const g=grants.find(x=>x.id===sel); if(!g){ el.innerHTML=noGrant; return; }
    const all=subs; const hi=all.filter(x=>x.risk==='High').length;
    const od=all.filter(x=>x.agreementStatus==='Executed'&&subNextMonitor(x)&&subNextMonitor(x)<today).length;
    const ending=all.filter(x=>x.end&&diffDays(today,x.end)>=0&&diffDays(today,x.end)<=90&&x.agreementStatus==='Executed').length;
    const noLegal=all.filter(x=>['Draft'].includes(x.agreementStatus)).length;
    const mine=forGrant(subs,g); const mons=forGrant(monitoring,g).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
    const cols=[
      {f:'name',l:'Subrecipient',w:180},{f:'uei',l:'UEI',w:110},{f:'amount',l:'Subaward ($)',t:'number',step:1000,w:110},{f:'start',l:'Start',t:'date',w:135},{f:'end',l:'End',t:'date',w:135},
      {f:'risk',l:'Risk',t:'select',opts:['Not assessed','Low','Medium','High'],w:110},{f:'riskDate',l:'Risk assessed',t:'date',w:135},{f:'monitorFreq',l:'Monitor every (mo)',t:'number',step:1,w:90},
      {f:'lastMonitored',l:'Last monitored',t:'date',w:135},
      {l:'Next monitoring',calc:x=>{ const n=subNextMonitor(x); return n?fd(n)+(n<today&&x.agreementStatus==='Executed'?'<div class="small flag-bad">overdue</div>':''):'<span class="muted">Not scheduled</span>'; }},
      {f:'agreementStatus',l:'Agreement',t:'select',opts:['Draft','Legal review','Executed','Expired','Terminated'],w:120},
      {l:'Invoiced',calc:x=>{ const t=invoices.filter(i=>i.grantId===g.id&&(i.party||'').trim().toLowerCase()===(x.name||'').trim().toLowerCase()).reduce((s,i)=>s+(+i.amount||0),0); const a=+x.amount||0; return money(t)+(a?`<div class="small ${t>a?'flag-bad':'muted'}">${Math.round(t/a*100)}% of subaward</div>`:''); }},
      {l:'Agreement end',calc:x=>x.end?timing(x.end)||'—':'—'},
      {f:'notes',l:'Notes',w:180}];
    const mcols=[
      {f:'date',l:'Date',t:'date',w:135},{l:'Subrecipient',calc:r=>esc((subs.find(x=>x.id===r.subId)||{}).name||'—')},
      {f:'type',l:'Type',t:'select',opts:['Desk review','Site visit','Invoice review','Report review'],w:130},{f:'findings',l:'Findings',w:260},
      {f:'followUpDue',l:'Follow-up due',t:'date',w:135},{f:'status',l:'Status',t:'select',opts:['Open','Resolved'],w:110},{l:'Timing',calc:r=>r.status==='Resolved'?'—':(timing(r.followUpDue)||'—')}];
    FORMS['f-sub']={coll:'subs',log:d=>'Added subrecipient: '+d.name,build:v=>v.name?{grantId:g.id,name:v.name,uei:v.uei,amount:v.amount||0,start:v.start,end:v.end,risk:v.risk,riskDate:today,monitorFreq:v.monitorFreq||0,lastMonitored:'',agreementStatus:'Draft',notes:''}:null};
    FORMS['f-mon']={coll:'monitoring',log:d=>'Logged monitoring: '+d.type,
      build:v=>{ const sb=mine.find(x=>x.name===v.sub); return sb?{grantId:g.id,subId:sb.id,date:v.date||today,type:v.type,findings:v.findings,followUpDue:v.followUpDue,status:v.status}:null; },
      after:async d=>{ await db.collection('subs').doc(d.subId).update({lastMonitored:d.date}); }};
    renderInto(el,`
      <div class="grid-stats">${stat(all.length,'Subrecipients (all grants)')}${stat(hi,'High risk',hi?'bad':'')}${stat(od,'Monitoring overdue',od?'bad':'')}${stat(ending,'Agreements ending in 90 days')}${stat(noLegal,'Agreements still in draft')}</div>
      <div class="card"><h2 style="margin-bottom:6px;">Subrecipient register: ${esc(g.name)}</h2>
        <p class="small muted" style="margin-bottom:12px;">Record the risk rating at award and set how often to monitor. Typical monitoring reviews financial reports, invoices against the approved budget and scope, and performance against deliverables. The monitoring interval is a starting assumption of 6 months. Set it by risk. Agreements still in draft usually need Legal review, which you can request on the Requests &amp; Staffing tab.</p>
        ${tableHTML('subs',mine,cols,1900)}
        <h3 style="margin:18px 0 10px;">Add a subrecipient</h3>
        ${formHTML('f-sub',[{n:'name',l:'Name',w:2,req:true},{n:'uei',l:'UEI'},{n:'amount',l:'Subaward ($)',t:'number',step:1000},{n:'start',l:'Start',t:'date'},{n:'end',l:'End',t:'date'},{n:'risk',l:'Risk',t:'select',opts:['Not assessed','Low','Medium','High'],v:'Not assessed'},{n:'monitorFreq',l:'Monitor every (months)',t:'number',v:6}],'Add subrecipient')}
      </div>
      <div class="card"><h2 style="margin-bottom:6px;">Monitoring log</h2>
        ${tableHTML('monitoring',mons,mcols,1000)}
        ${mine.length?`<h3 style="margin:18px 0 10px;">Log a monitoring review</h3>${formHTML('f-mon',[{n:'sub',l:'Subrecipient',t:'select',opts:mine.map(x=>x.name),w:2},{n:'date',l:'Date',t:'date',v:today},{n:'type',l:'Type',t:'select',opts:['Desk review','Site visit','Invoice review','Report review']},{n:'findings',l:'Findings',w:3,mw:260},{n:'followUpDue',l:'Follow-up due',t:'date'},{n:'status',l:'Status',t:'select',opts:['Open','Resolved']}],'Log review')}`:'<p class="small muted" style="margin-top:12px;">Add a subrecipient above to log monitoring reviews.</p>'}
      </div>`);
  }

  // ---- Amendments ----
  function renderAmend(){
    const el=$('amendBody'); const g=grants.find(x=>x.id===sel); if(!g){ el.innerHTML=noGrant; return; }
    const rows=forGrant(amendments,g).sort((a,b)=>(a.neededBy||'9').localeCompare(b.neededBy||'9'));
    const late=rows.filter(a=>a.status==='Draft'&&a.neededBy&&addDays(a.neededBy,-(+a.leadDays||0))<today).length;
    const pend=rows.filter(a=>a.status==='Submitted').length;
    const cols=[
      {f:'type',l:'Type',t:'select',opts:['No-cost extension','Rebudget','Scope change','Key personnel change','Contract amendment','Other'],w:170},{f:'description',l:'Description',w:280},
      {f:'neededBy',l:'Needed by',t:'date',w:140},{f:'leadDays',l:'Funder lead (days)',t:'number',step:1,w:90},
      {l:'Submit by',calc:a=>{ if(!a.neededBy) return '—'; const sb=addDays(a.neededBy,-(+a.leadDays||0)); const l=a.status==='Draft'&&sb<today; return `<span class="${l?'flag-bad':''}">${fd(sb)}</span>${a.status==='Draft'?timing(sb):''}`; }},
      {f:'submittedAt',l:'Submitted',t:'date',w:140},{f:'status',l:'Status',t:'select',opts:['Draft','Submitted','Approved','Denied'],w:120},{f:'approvedAt',l:'Decision date',t:'date',w:140}];
    FORMS['f-am']={coll:'amendments',log:d=>'Logged '+d.type+' request',build:v=>v.description?{grantId:g.id,type:v.type,description:v.description,neededBy:v.neededBy,leadDays:v.leadDays!=null?v.leadDays:lt().amend,submittedAt:'',status:'Draft',approvedAt:''}:null};
    renderInto(el,`
      <div class="grid-stats">${stat(rows.length,'Requests on this grant')}${stat(pend,'Awaiting funder')}${stat(late,'Past submit-by date',late?'bad':'')}</div>
      <div class="card"><h2 style="margin-bottom:6px;">No-cost extensions, rebudgets and amendments</h2>
        <p class="small muted" style="margin-bottom:12px;">Funder approvals take time, so the app works backward from the date you need the decision. The default funder lead time of ${lt().amend} days is an assumption. Set it from the funder's guidance.</p>
        ${tableHTML('amendments',rows,cols,1150)}
        <h3 style="margin:18px 0 10px;">Log a request</h3>
        ${formHTML('f-am',[{n:'type',l:'Type',t:'select',opts:['No-cost extension','Rebudget','Scope change','Key personnel change','Contract amendment','Other'],w:1.5},{n:'description',l:'What and why',w:3,mw:260,req:true},{n:'neededBy',l:'Decision needed by',t:'date'},{n:'leadDays',l:'Funder lead (days)',t:'number',v:lt().amend}],'Log request')}
      </div>`);
  }

  // ---- Closeout ----
  function closeoutItems(g){
    const e=awardEnd(g); const O=(t,d,o)=>({track:'Closeout',title:'Closeout: '+t,owner:o||'Program Manager',due:addDays(e,d),gate:false});
    return [O('Notify subrecipients the award is closing; request final invoices and reports',-60),
      O('Dispose of or transfer equipment and property per award terms',60),
      O('Collect final subrecipient invoices and reports',30,'Program Manager'),
      O('Reconcile final spend to Oracle and resolve unposted invoices',45,'Grants Finance'),
      O('Submit final financial report',90,'Grants Finance'),
      O('Submit final performance report',90),
      O('Liquidate obligations; return any unobligated or disallowed funds',90,'Grants Finance'),
      O('Final drawdown and reconciliation',90,'Grants Finance'),
      O('Set up records retention (confirm the period with the funder)',120),
      O('Lessons learned and unspent-funds analysis',120)];
  }
  function renderCloseout(){
    const el=$('closeoutBody'); const g=grants.find(x=>x.id===sel); if(!g){ el.innerHTML=noGrant; return; }
    const m=baseMetrics(g); const aE=awardEnd(g);
    const items=m.tk.filter(t=>t.track==='Closeout').sort((a,b)=>(a.due||'9').localeCompare(b.due||'9'));
    const done=items.filter(t=>t.done).length;
    const unob=Math.max(0,g.amount-m.actual);
    const ending=grants.map(x=>({x,m:baseMetrics(x)})).filter(r=>diffDays(today,awardEnd(r.x))<=180&&diffDays(today,awardEnd(r.x))>=-120).sort((a,b)=>awardEnd(a.x).localeCompare(awardEnd(b.x)));
    renderInto(el,`
      <div class="card"><h2 style="margin-bottom:6px;">Grants in or near closeout</h2>
        <p class="small muted" style="margin-bottom:12px;">Ending within 180 days or ended within the last 120 days. Federal awards generally allow 120 days after the period ends to complete closeout reporting. Use the funder's own date for non-federal funds.</p>
        ${ending.length?'<div class="scroll"><table><tr><th>Grant</th><th>Award ends</th><th>Closeout window ends</th><th>Unobligated estimate</th><th>Closeout tasks</th></tr>'+ending.map(({x,m:mm})=>{ const c=mm.tk.filter(t=>t.track==='Closeout'); const d=c.filter(t=>t.done).length; return `<tr><td><b>${esc(x.name)}</b></td><td>${fd(awardEnd(x))}${timing(awardEnd(x))}</td><td>${fd(addDays(awardEnd(x),120))}</td><td>${money(Math.max(0,x.amount-mm.actual))}</td><td>${c.length?d+'/'+c.length+' done':'<span class="flag-warn">No checklist yet</span>'}</td></tr>`; }).join('')+'</table></div>':'<p class="empty">No grants in the closeout window.</p>'}
      </div>
      <div class="grid-stats">${stat(fd(aE),'Award ends')}${stat(fd(addDays(aE,120)),'120-day closeout window ends')}${stat(money(unob),'Unobligated balance (estimate)',unob>0&&diffDays(today,aE)<180?'bad':'')}${stat(done+'/'+items.length,'Closeout tasks done')}</div>
      <div class="card"><h2 style="margin-bottom:6px;">Closeout checklist: ${esc(g.name)}</h2>
        <p class="small muted" style="margin-bottom:12px;">Includes final financial and performance reports, property, subrecipient closeout, reconciliation, return of funds and record retention. Dates are offsets from the award end date. Adjust them to the award terms.</p>
        ${items.length?'<div class="scroll"><table><tr><th style="width:40px;"></th><th>Task</th><th>Owner</th><th>Due</th></tr>'+items.map(t=>`<tr><td><input type="checkbox" class="t-done" data-id="${esc(t.id)}" ${t.done?'checked':''} ${canWrite?'':'disabled'}></td><td style="${t.done?'text-decoration:line-through; color:var(--ink-soft);':''}">${esc(t.title)}</td><td><input type="text" class="t-owner" data-id="${esc(t.id)}" value="${esc(t.owner||'')}" placeholder="Assign an owner" ${canWrite?'':'disabled'}></td><td><input type="date" class="t-due" data-id="${esc(t.id)}" value="${esc(t.due||'')}" ${canWrite?'':'disabled'}></td></tr>`).join('')+'</table></div>':'<p class="empty">No closeout tasks yet.</p>'}
        <div style="margin-top:12px;"><button class="ghost" id="closeAdd" ${canWrite?'':'disabled'}>Add the standard closeout checklist</button></div>
      </div>`);
    el.querySelectorAll('.t-done').forEach(c=>c.addEventListener('change',e=>setDone(c.dataset.id,e.target.checked)));
    el.querySelectorAll('.t-owner').forEach(c=>c.addEventListener('change',async e=>{ if(!canWrite) return; try{await db.collection('tasks').doc(c.dataset.id).update({owner:e.target.value});}catch(x){console.error(x);} }));
    el.querySelectorAll('.t-due').forEach(c=>c.addEventListener('change',async e=>{ if(!canWrite) return; try{await db.collection('tasks').doc(c.dataset.id).update({due:e.target.value||''});}catch(x){console.error(x);} }));
  }

  // ================= PHASE 1 · PRE-AWARD =================
  const OPP_STATUS=['Prospecting','Go/No-go','Drafting','Internal review','Submitted','Awarded','Declined'];
  const APPROVERS=['Sponsor','Program manager','Grants Finance (budget)','HR (staffing)','Legal','Compliance / IT'];
  const OB_CATS=CATS.filter(c=>c!=='Indirect');
  const oppAppr=o=>{ const a=o.approvals||{}; return {done:APPROVERS.filter(r=>a[r]&&a[r].status==='Approved').length,total:APPROVERS.length}; };
  function startAwardFromOpp(o){
    const setV=(id,v)=>{ const x=$(id); if(x) x.value=v; };
    const noa=o.estAward||today; const start=addDays(noa,14); const end=addDays(addMonthsISO(start,+o.termMonths||12),-1);
    setV('in-name',o.name||''); setV('in-funder',o.funder||''); setV('in-sponsor',o.lead||''); setV('in-amount',o.amount||0); setV('in-noa',noa); setV('in-start',start); setV('in-end',end);
    $('in-hiring').checked=!!o.hiring; $('in-existing').checked=!!o.existing; $('in-subs').checked=!!o.subs; $('in-subs150').disabled=!o.subs; $('in-subs150').checked=!!(o.subs&&o.subs150);
    renderPreview(); setTab('intake');
    if(db&&canWrite){ db.collection('opps').doc(o.id).update({status:'Awarded'}).catch(()=>{}); logAct('', 'Started award from opportunity: '+o.name); }
  }
  function renderPipeline(){
    const el=$('pipelineBody');
    const live=opps.filter(o=>!['Awarded','Declined'].includes(o.status));
    const pipe=live.reduce((s,o)=>s+(+o.amount||0),0), wt=live.reduce((s,o)=>s+(+o.amount||0)*(+o.prob||0)/100,0);
    const soon=live.filter(o=>o.deadline&&diffDays(today,o.deadline)>=0&&diffDays(today,o.deadline)<=30).length;
    const risky=live.filter(o=>o.deadline&&diffDays(today,o.deadline)>=0&&diffDays(today,o.deadline)<=14&&oppAppr(o).done<oppAppr(o).total&&['Drafting','Internal review','Go/No-go'].includes(o.status)).length;
    const rows=opps.slice().sort((a,b)=>(a.deadline||'9').localeCompare(b.deadline||'9'));
    const cols=[
      {f:'name',l:'Opportunity',w:200},{f:'funder',l:'Funder',w:140},{f:'nofo',l:'NOFO / ALN',w:110},{f:'deadline',l:'Application due',t:'date',w:140},{f:'estAward',l:'Est. award date',t:'date',w:140},
      {f:'amount',l:'Request ($)',t:'number',step:1000,w:110},{f:'prob',l:'Win %',t:'number',step:5,w:70},{f:'status',l:'Stage',t:'select',opts:OPP_STATUS,w:130},{f:'lead',l:'Lead',w:120},
      {l:'Weighted ($)',calc:o=>money((+o.amount||0)*(+o.prob||0)/100)},{l:'Due',calc:o=>['Awarded','Declined','Submitted'].includes(o.status)?'—':(timing(o.deadline)||'—')},
      {l:'Sign-offs',calc:o=>{ const a=oppAppr(o); return `<span class="${a.done===a.total?'flag-ok':''}">${a.done}/${a.total}</span>`; }},
      {l:'',calc:o=>`<button class="ghost opp-open" data-id="${esc(o.id)}">Readiness</button> ${['Declined','Awarded'].includes(o.status)?'':`<button class="ghost opp-convert" data-id="${esc(o.id)}" ${canWrite?'':'disabled'}>Start award</button>`}`}];
    FORMS['f-opp']={coll:'opps',log:d=>'Added opportunity: '+d.name,build:v=>v.name?{name:v.name,funder:v.funder,nofo:v.nofo,deadline:v.deadline,estAward:v.estAward,amount:v.amount||0,prob:v.prob!=null?v.prob:25,status:v.status,lead:v.lead,termMonths:v.termMonths||12,hiring:v.hiring,existing:v.existing,subs:v.subs,subs150:v.subs&&v.subs150,approvals:{},obudget:{},orate:null,match:v.match}:null};
    renderInto(el,`
      <div class="grid-stats">${stat(live.length,'Live opportunities')}${stat(money(pipe),'Pipeline value')}${stat(money(wt),'Probability-weighted')}${stat(soon,'Applications due in 30 days')}${stat(risky,'Due in 14 days, sign-offs incomplete',risky?'bad':'')}</div>
      <div class="card"><h2 style="margin-bottom:6px;">Funding opportunities</h2>
        <p class="small muted" style="margin-bottom:12px;">Track every opportunity from prospecting to award. "Readiness" opens the sign-off routing, budget builder and a can-we-spend-it check. "Start award" carries the details into New Award.</p>
        ${tableHTML('opps',rows,cols,1700)}
        <h3 style="margin:18px 0 10px;">Add an opportunity</h3>
        ${formHTML('f-opp',[{n:'name',l:'Opportunity',w:2,req:true,mw:220},{n:'funder',l:'Funder'},{n:'nofo',l:'NOFO / ALN'},{n:'deadline',l:'Application due',t:'date'},{n:'estAward',l:'Est. award date',t:'date'},{n:'amount',l:'Request ($)',t:'number',step:1000},{n:'prob',l:'Win %',t:'number',step:5,v:25,mw:90},{n:'termMonths',l:'Term (months)',t:'number',v:12,mw:100},{n:'status',l:'Stage',t:'select',opts:OPP_STATUS},{n:'lead',l:'Lead'},{n:'match',l:'Match required (%)',t:'number',mw:120},{n:'hiring',l:'Needs hiring',t:'check',mw:140},{n:'existing',l:'Existing staff',t:'check',mw:140},{n:'subs',l:'Subrecipients',t:'check',mw:140},{n:'subs150',l:'Contracts over $150k',t:'check',mw:180}],'Add opportunity')}
      </div>`);
  }
  function renderApplication(){
    const el=$('applicationBody');
    const sorted=opps.slice().sort((a,b)=>(a.deadline||'9').localeCompare(b.deadline||'9'));
    if(!sorted.length){ el.innerHTML='<div class="card"><p class="empty">No opportunities yet. Add one on the Opportunities tab.</p></div>'; return; }
    if(!opps.find(o=>o.id===osel)) osel=sorted[0].id;
    const o=opps.find(x=>x.id===osel); const ap=o.approvals||{}; const ob=o.obudget||{};
    const direct=OB_CATS.reduce((s,c)=>s+(+ob[c]||0),0); const rate=o.orate!=null&&o.orate!==''?+o.orate:null; const ind=rate!=null?direct*rate/100:0; const total=direct+ind;
    const est=o.estAward||addDays(today,90); const start=addDays(est,14); const pseudo={name:o.name,amount:o.amount||0,noaDate:est,startDate:start,endDate:addDays(addMonthsISO(start,+o.termMonths||12),-1),hiring:o.hiring,existing:o.existing,subs:o.subs,subs150:o.subs150&&o.subs};
    let rd='';
    if(pseudo.amount>0){
      const ps=plan(pseudo,'serial'), pp=plan(pseudo,'parallel'); const aEnd=pseudo.endDate; const len=diffDays(start,aEnd)+1;
      const runway=diffDays(pp.impl,aEnd); const pct=runway/len; const rm=Math.max(0,Math.round(runway/30.4)), tm=Math.round(len/30.4);
      const cls=runway<=0?'bad':(pct<0.5?'warn':'good');
      const msg=runway<=0?'If awarded on the estimated date, the award would end before full implementation. Negotiate the start or pre-stage the work.':(pct<0.5?'Only '+rm+' of '+tm+' months would be left to spend after go-live. Plan the pre-award work now.':rm+' of '+tm+' months of spending runway after go-live (parallel plan). Looks workable.');
      rd=`<div class="banner ${cls}" style="margin-bottom:12px;"><b>${msg}</b></div><div class="compare"><div class="stat"><div class="muted small">Go-live as mapped today (serial)</div><div class="num">${fd(ps.impl)}</div></div><div class="stat"><div class="muted small">Go-live in parallel</div><div class="num">${fd(pp.impl)}</div></div><div class="stat"><div class="muted small">Annual value</div><div class="num">${money(pp.annual)}</div><div class="small muted">${pp.annual>150000?'Over $150k: Board required':'Under the Board threshold'}</div></div></div>`;
    } else rd='<p class="empty">Enter a request amount to see the readiness check.</p>';
    const a=oppAppr(o);
    renderInto(el,`
      <div class="card"><div class="field" style="max-width:480px;"><label>Opportunity</label><select id="osel">${sorted.map(x=>`<option value="${esc(x.id)}" ${x.id===osel?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div></div>
      <div class="card"><h2 style="margin-bottom:6px;">${esc(o.name)}</h2>
        <p class="small muted">${esc(o.funder||'—')} · ${esc(o.nofo||'No NOFO listed')} · Application due ${fd(o.deadline)} ${o.deadline?'('+(diffDays(today,o.deadline)<0?Math.abs(diffDays(today,o.deadline))+' days ago':'in '+diffDays(today,o.deadline)+' days')+')':''} · Request ${money(o.amount)} · Est. award ${fd(o.estAward)}${o.match?' · Match required '+o.match+'%':''}</p>
      </div>
      <div class="card"><h2 style="margin-bottom:6px;">Can we spend it?</h2>
        <p class="small muted" style="margin-bottom:12px;">Runs your lead times against the estimated award date, assuming the period starts 14 days after the award.</p>${rd}
      </div>
      <div class="card"><h2 style="margin-bottom:6px;">Internal sign-off routing <span class="small muted" style="font-weight:400;">${a.done}/${a.total} approved</span></h2>
        <p class="small muted" style="margin-bottom:12px;">Everyone who touches the money should agree to the scope, budget, staffing and legal terms before the application goes out.</p>
        <div class="scroll"><table><tr><th>Sign-off</th><th>Approver</th><th>Status</th><th>Date</th></tr>
        ${APPROVERS.map(r=>{ const x=ap[r]||{name:'',status:'Pending',date:''}; return `<tr><td><b>${esc(r)}</b></td><td><input type="text" class="ap-f" data-id="${esc(o.id)}" data-role="${esc(r)}" data-f="name" value="${esc(x.name||'')}" ${canWrite?'':'disabled'}></td><td><select class="ap-f" data-id="${esc(o.id)}" data-role="${esc(r)}" data-f="status" ${canWrite?'':'disabled'}>${['Pending','Approved','Needs changes'].map(s=>`<option ${x.status===s?'selected':''}>${s}</option>`).join('')}</select></td><td><input type="date" class="ap-f" data-id="${esc(o.id)}" data-role="${esc(r)}" data-f="date" value="${esc(x.date||'')}" ${canWrite?'':'disabled'}></td></tr>`; }).join('')}
        </table></div>
      </div>
      <div class="card"><h2 style="margin-bottom:6px;">Budget builder</h2>
        <p class="small muted" style="margin-bottom:12px;">Build the request by category. Indirect is calculated on all direct lines at the rate you enter. Confirm the funder's indirect base rules.</p>
        <div class="row" style="display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end;">
          ${OB_CATS.map(c=>`<div class="field" style="min-width:150px;"><label>${esc(c)}</label><input type="number" class="ob-f" data-id="${esc(o.id)}" data-cat="${esc(c)}" min="0" step="any" value="${ob[c]!=null?ob[c]:''}" ${canWrite?'':'disabled'}></div>`).join('')}
          <div class="field" style="min-width:130px;"><label>Indirect rate (%)</label><input type="number" class="ob-f" data-id="${esc(o.id)}" data-cat="__rate" min="0" step="any" value="${rate!=null?rate:''}" ${canWrite?'':'disabled'}></div>
        </div>
        <div class="grid-stats" style="margin-top:14px;">${stat(money(direct),'Direct costs')}${stat(money(ind),'Indirect')}${stat(money(total),'Total budget')}${stat(money(o.amount),'Requested amount')}</div>
        ${total>0&&Math.abs(total-(+o.amount||0))>1?`<div class="banner warn" style="margin-top:12px;">The budget totals ${money(total)}, but the request is ${money(o.amount)}.</div>`:''}
      </div>`);
  }

  // ================= PHASE 2 · AWARD SET-UP: TEMPLATES =================
  function parseReports(txt){ return (txt||'').split(';').map(x=>x.trim()).filter(Boolean).map(x=>{ const p=x.split('|').map(y=>y.trim()); const f=FREQS.find(q=>q.toLowerCase()===(p[1]||'').toLowerCase())||'One-time'; return {name:p[0],freq:f}; }); }
  function parseSplit(txt){ return (txt||'').split(';').map(x=>x.trim()).filter(Boolean).map(x=>{ const p=x.split('|').map(y=>y.trim()); return {category:p[0],pct:parseFloat(p[1])||0}; }); }
  function applyTemplate(){
    const t=templates.find(x=>x.id===$('in-template').value); if(!t) return;
    const setV=(id,v)=>{ const x=$(id); if(x&&v!=null) x.value=v; };
    setV('in-funder',t.funder||''); setV('in-tier',t.tier||'2');
    $('in-hiring').checked=!!t.hiring; $('in-existing').checked=!!t.existing; $('in-subs').checked=!!t.subs; $('in-subs150').disabled=!t.subs; $('in-subs150').checked=!!(t.subs&&t.subs150);
    if(t.termMonths&&$('in-start').value){ setV('in-end',addDays(addMonthsISO($('in-start').value,+t.termMonths),-1)); }
    renderPreview();
  }
  function renderTemplates(){
    const sel2=$('in-template'); if(sel2){ const cur=sel2.value; sel2.innerHTML='<option value="">None</option>'+templates.map(t=>`<option value="${esc(t.id)}" ${t.id===cur?'selected':''}>${esc(t.name)}</option>`).join(''); }
    const el=$('templatesBody');
    const cols=[
      {f:'name',l:'Template',w:200},{f:'funder',l:'Funder',w:150},{f:'tier',l:'Tier',t:'select',opts:['1','2','3'],w:70},{f:'termMonths',l:'Term (months)',t:'number',w:90},
      {f:'hiring',l:'Hiring',t:'check'},{f:'existing',l:'Existing staff',t:'check'},{f:'subs',l:'Subrecipients',t:'check'},{f:'subs150',l:'Contracts >$150k',t:'check'},
      {f:'reportsText',l:'Reports (name | frequency; …)',w:280},{f:'splitText',l:'Budget split (category | %; …)',w:280},
      {l:'',calc:t=>`<button class="ghost tpl-apply" data-id="${esc(t.id)}">Use for a new award</button>`}];
    FORMS['f-tpl']={coll:'templates',log:d=>'Created template: '+d.name,build:v=>v.name?{name:v.name,funder:v.funder,tier:v.tier,termMonths:v.termMonths||12,hiring:v.hiring,existing:v.existing,subs:v.subs,subs150:v.subs&&v.subs150,reportsText:v.reportsText,splitText:v.splitText}:null};
    renderInto(el,`
      <div class="card"><h2 style="margin-bottom:6px;">Award templates</h2>
        <p class="small muted" style="margin-bottom:12px;">A template pre-fills the routing questions and, when you create the award, adds its report schedule and budget lines. Use the format <b>PPR | quarterly; FFR | annual</b> for reports and <b>Personnel | 55; Fringe | 15</b> for the budget split. You can also save the New Award form as a template.</p>
        ${tableHTML('templates',templates,cols,1900)}
        <h3 style="margin:18px 0 10px;">Create a template</h3>
        ${formHTML('f-tpl',[{n:'name',l:'Template name',w:2,req:true},{n:'funder',l:'Funder'},{n:'tier',l:'Tier',t:'select',opts:['1','2','3'],v:'2',mw:80},{n:'termMonths',l:'Term (months)',t:'number',v:12,mw:100},{n:'hiring',l:'Hiring',t:'check',mw:110},{n:'existing',l:'Existing staff',t:'check',mw:140},{n:'subs',l:'Subrecipients',t:'check',mw:140},{n:'subs150',l:'Contracts >$150k',t:'check',mw:170},{n:'reportsText',l:'Reports (name | frequency; …)',w:3,mw:280},{n:'splitText',l:'Budget split (category | %; …)',w:3,mw:280}],'Create template')}
      </div>`);
  }
  $('in-template').addEventListener('change',applyTemplate);
  $('in-savetpl').addEventListener('click',async()=>{
    if(!db||!canWrite) return; const g=readIntake(); if(!g.name) { $('in-name').focus(); return; }
    const months=(g.startDate&&g.endDate)?Math.max(1,Math.round((diffDays(g.startDate,g.endDate)+1)/30.44)):12;
    try{ await db.collection('templates').add({name:g.name+' (template)',funder:g.funder,tier:g.tier,termMonths:months,hiring:g.hiring,existing:g.existing,subs:g.subs,subs150:g.subs150,reportsText:'',splitText:''}); logAct('','Saved template from award form'); }catch(e){console.error(e);}
  });

  // ================= ADMIN =================
  function renderActivity(){
    const el=$('activityBody'); if(!el) return;
    const rows=activity.slice().sort((a,b)=>(b.ts||'').localeCompare(a.ts||'')).slice(0,150);
    el.innerHTML=`<div class="card"><h2 style="margin-bottom:6px;">Activity log</h2><p class="small muted" style="margin-bottom:12px;">Key actions are recorded with the time and a short user ID, so changes to awards, tasks, budgets and requests can be traced. This is a working log, not a substitute for the audit trail in Oracle.</p>
      ${rows.length?'<div class="scroll"><table><tr><th>When</th><th>Grant</th><th>What happened</th><th>User</th></tr>'+rows.map(r=>`<tr><td class="muted" style="white-space:nowrap;">${esc((r.ts||'').slice(0,16).replace('T',' '))}</td><td>${r.grantId?esc(gname(r.grantId)):'—'}</td><td>${esc(r.text)}</td><td class="muted">${esc(r.user||'—')}</td></tr>`).join('')+'</table></div>':'<p class="empty">No activity recorded yet.</p>'}</div>`;
  }
  function renderConfig(){
    const el=$('configBody'); if(!el) return; const B=burn();
    if(el.contains(document.activeElement)&&document.activeElement.classList.contains('burn-f')) return;
    el.innerHTML=`<div class="card"><h2 style="margin-bottom:6px;">Risk thresholds</h2>
      <p class="small muted" style="margin-bottom:12px;">These control the Watch and At Risk flags. "Points behind" is how far spend trails the share of the award's life that has elapsed. Your lifecycle checklist escalates to the sponsor at 20 points.</p>
      <div class="row" style="display:flex; gap:12px; flex-wrap:wrap;">
        <div class="field"><label>Watch: points behind time</label><input type="number" class="burn-f" data-k="gapYellow" min="0" step="any" value="${B.gapYellow}" ${canWrite?'':'disabled'}></div>
        <div class="field"><label>At risk: points behind time</label><input type="number" class="burn-f" data-k="gapRed" min="0" step="any" value="${B.gapRed}" ${canWrite?'':'disabled'}></div>
        <div class="field"><label>Watch: projected lapse (% of award)</label><input type="number" class="burn-f" data-k="lapseYellow" min="0" step="any" value="${B.lapseYellow}" ${canWrite?'':'disabled'}></div>
        <div class="field"><label>At risk: projected lapse (% of award)</label><input type="number" class="burn-f" data-k="lapseRed" min="0" step="any" value="${B.lapseRed}" ${canWrite?'':'disabled'}></div>
      </div></div>
      <div class="card"><h2 style="margin-bottom:6px;">Who can edit</h2>
        <p class="small muted">Edit rights come from how this page is shared: Viewers read, Contributors and above edit. All data entry fields (budget, drawdowns, invoices) follow the same rule. To limit budget and drawdown edits to Finance only, the page's data rules can be tightened. Say the word and I'll set that up once roles are confirmed.</p></div>`;
  }

  // ================= OVERVIEW: LIFECYCLE CARDS =================
  function renderPhaseCards(){
    const el=$('phaseCards'); if(!el) return;
    const live=opps.filter(o=>!['Awarded','Declined'].includes(o.status));
    const wt=live.reduce((s,o)=>s+(+o.amount||0)*(+o.prob||0)/100,0);
    const nextDl=live.filter(o=>o.deadline&&o.deadline>=today).sort((a,b)=>a.deadline.localeCompare(b.deadline))[0];
    const setupTracks=new Set(['Setup','Board','Hiring','Existing staff','Subrecipients','Go-live']);
    const inSetup=grants.filter(g=>tasks.some(t=>t.grantId===g.id&&setupTracks.has(t.track)&&!t.done));
    const gates=tasks.filter(t=>t.track==='Board'&&!t.done&&t.due&&diffDays(today,t.due)<=30).length;
    const openReq=requests.filter(r=>!['Complete','Declined','Closed','Approved'].includes(r.status)).length;
    const repLate=reports.filter(r=>!['Submitted','Accepted'].includes(r.status)&&r.due&&r.due<today).length;
    const repSoon=reports.filter(r=>!['Submitted','Accepted'].includes(r.status)&&r.due&&diffDays(today,r.due)>=0&&diffDays(today,r.due)<=30).length;
    const unposted=invoices.filter(i=>!['Posted','Paid'].includes(i.status)).reduce((s,i)=>s+(+i.amount||0),0);
    const teLate=timeeffort.filter(t=>t.status!=='Certified'&&t.due&&t.due<today).length;
    const monLate=subs.filter(x=>x.agreementStatus==='Executed'&&subNextMonitor(x)&&subNextMonitor(x)<today).length;
    const closing=grants.filter(g=>diffDays(today,awardEnd(g))<=180&&diffDays(today,awardEnd(g))>=0).length;
    const go=(tab,txt)=>`<a href="#" data-go="${tab}" style="color:var(--accent-ink); font-weight:700;">${txt}</a>`;
    el.innerHTML=`
      <div class="phase-card" style="border-top-color:#9fb0c4;"><h3>1 · Pre-Award</h3><ul>
        <li>${live.length} live opportunit${live.length===1?'y':'ies'}, ${money(wt)} weighted</li>
        <li>${nextDl?'Next application due '+fd(nextDl.deadline)+': '+esc(nextDl.name):'No application deadlines ahead'}</li>
        <li>${go('pipeline','Open the pipeline')}</li></ul></div>
      <div class="phase-card" style="border-top-color:#c9973f;"><h3>2 · Award Set-Up</h3><ul>
        <li>${inSetup.length} grant${inSetup.length===1?'':'s'} with set-up steps still open</li>
        <li>${gates} Board item${gates===1?'':'s'} due within 30 days or overdue</li>
        <li>${openReq} legal or staffing request${openReq===1?'':'s'} open</li>
        <li>${go('intake','Start a new award')}</li></ul></div>
      <div class="phase-card" style="border-top-color:#3f7a53;"><h3>3 · Post-Award</h3><ul>
        <li>${repLate} report${repLate===1?'':'s'} overdue, ${repSoon} due in 30 days</li>
        <li>${money(unposted)} in invoices not yet posted</li>
        <li>${teLate} T&amp;E certification${teLate===1?'':'s'} overdue, ${monLate} monitoring review${monLate===1?'':'s'} overdue</li>
        <li>${closing} grant${closing===1?'':'s'} ending within 180 days · ${go('closeout','Closeout')}</li></ul></div>`;
    el.querySelectorAll('[data-go]').forEach(a=>a.addEventListener('click',e=>{ e.preventDefault(); setTab(a.dataset.go); }));
  }

  // ---------- RISKS ----------
  const PV={Low:1,Medium:2,High:3};
  const riskScore=r=>(PV[r.prob]||0)*(PV[r.impact]||0);
  const riskRating=s=>s>=6?'High':(s>=3?'Medium':'Low');
  function riskFlag(r){ if(r.status==='Closed'||r.status==='Mitigated') return ''; if(r.trigger&&r.trigger<today) return 'PAST TRIGGER'; if(!r.lastReviewed||diffDays(r.lastReviewed,today)>14) return 'STALE'; return ''; }
  const STATUSES=['Open','Monitoring','Mitigated','Occurred - Now an Issue','Closed'];
  function renderRisks(){
    const live=risks.filter(r=>r.status!=='Closed');
    const high=live.filter(r=>riskRating(riskScore(r))==='High').length;
    const stale=live.filter(r=>riskFlag(r)==='STALE').length, past=live.filter(r=>riskFlag(r)==='PAST TRIGGER').length;
    $('riskStats').innerHTML=`
      <div class="stat"><div class="num">${live.length}</div><div class="muted small">Open risks and issues</div></div>
      <div class="stat"><div class="num ${high?'bad':''}">${high}</div><div class="muted small">Rated High</div></div>
      <div class="stat"><div class="num ${stale?'bad':''}">${stale}</div><div class="muted small">Stale (14+ days unreviewed)</div></div>
      <div class="stat"><div class="num ${past?'bad':''}">${past}</div><div class="muted small">Past trigger date</div></div>`;
    if(!risks.length){ $('riskTable').innerHTML='<p class="empty">No risks logged.</p>'; return; }
    const sorted=risks.slice().sort((a,b)=>(a.status==='Closed')-(b.status==='Closed')||riskScore(b)-riskScore(a));
    $('riskTable').innerHTML='<table><tr><th>Risk / issue</th><th>Score</th><th>Status</th><th>Review</th><th>Response and plan</th><th></th></tr>'+sorted.map(r=>{
      const s=riskScore(r), rt=riskRating(s), fl=riskFlag(r);
      return `<tr><td style="min-width:260px;"><b>${esc(r.title)}</b><div class="small muted">${esc(r.type||'')} · ${esc(r.grantName||'—')}${r.owner?' · '+esc(r.owner):' · <span class="flag-warn">No owner</span>'}</div>${r.statement?`<div class="small muted" style="margin-top:4px;">${esc(r.statement)}</div>`:''}</td>
        <td><span class="pill ${rt==='High'?'red':(rt==='Medium'?'yellow':'green')}">${rt} · ${s}</span><div class="small muted">${esc(r.prob||'')} × ${esc(r.impact||'')}</div></td>
        <td><select class="rk-status" data-id="${esc(r.id)}" ${canWrite?'':'disabled'}>${STATUSES.map(x=>`<option ${r.status===x?'selected':''}>${x}</option>`).join('')}</select></td>
        <td>${fl?`<span class="pill ${fl==='PAST TRIGGER'?'red':'yellow'}">${fl}</span>`:'<span class="pill green">Current</span>'}<div class="small muted">Reviewed ${r.lastReviewed?fd(r.lastReviewed):'never'}${r.trigger?'<br>Trigger '+fd(r.trigger):''}</div></td>
        <td class="small" style="min-width:240px;"><b>${esc(r.response||'')}</b>${r.plan?': '+esc(r.plan):''}</td>
        <td style="white-space:nowrap;"><button class="ghost rk-rev" data-id="${esc(r.id)}" ${canWrite?'':'disabled'}>Mark reviewed</button> <button class="ghost rk-del" data-id="${esc(r.id)}" ${canWrite?'':'disabled'}>Remove</button></td></tr>`; }).join('')+'</table>';
    $('riskTable').querySelectorAll('.rk-status').forEach(s=>s.addEventListener('change',async e=>{ if(!canWrite) return; try{await db.collection('risks').doc(s.dataset.id).update({status:e.target.value,lastReviewed:today});}catch(x){console.error(x);} }));
    $('riskTable').querySelectorAll('.rk-rev').forEach(b=>b.addEventListener('click',async()=>{ if(!canWrite) return; try{await db.collection('risks').doc(b.dataset.id).update({lastReviewed:today});}catch(x){console.error(x);} }));
    $('riskTable').querySelectorAll('.rk-del').forEach(b=>b.addEventListener('click',async()=>{ if(!canWrite) return; try{await db.collection('risks').doc(b.dataset.id).delete();}catch(x){console.error(x);} }));
  }
  $('riskForm').addEventListener('submit',async e=>{
    e.preventDefault(); if(!db||!canWrite) return;
    try{ await db.collection('risks').add({title:$('rk-title').value.trim(),grantName:$('rk-grant').value.trim(),type:$('rk-type').value,prob:$('rk-prob').value,impact:$('rk-impact').value,
      owner:$('rk-owner').value.trim(),response:$('rk-resp').value,plan:$('rk-plan').value.trim(),trigger:$('rk-trigger').value||'',status:'Open',lastReviewed:today,logged:today}); e.target.reset(); }
    catch(x){console.error(x);}
  });

  // ---------- CALENDAR ----------
  function renderCalendar(){
    const ms=meetings.slice().sort((a,b)=>a.date.localeCompare(b.date));
    $('boardTable').innerHTML=ms.length?'<table><tr><th>Board meeting</th><th>Submission cutoff</th><th>Status</th><th></th></tr>'+ms.map(m=>{
      const dc=diffDays(today,m.submitBy), dm=diffDays(today,m.date);
      const st=dm<0?'<span class="pill grey">Past</span>':(dc<0?'<span class="pill red">Cutoff passed</span>':(dc<=14?'<span class="pill yellow">Cutoff in '+dc+'d</span>':'<span class="pill green">Open</span>'));
      return `<tr><td><b>${fd(m.date)}</b>${m.note?'<div class="small muted">'+esc(m.note)+'</div>':''}</td><td>${fd(m.submitBy)}</td><td>${st}</td><td><button class="ghost bm-del" data-id="${esc(m.id)}" ${canWrite?'':'disabled'}>Remove</button></td></tr>`; }).join('')+'</table>':'<p class="empty">No meetings on the calendar.</p>';
    $('boardTable').querySelectorAll('.bm-del').forEach(b=>b.addEventListener('click',async()=>{ if(!canWrite) return; try{await db.collection('boardmeetings').doc(b.dataset.id).delete();}catch(e){console.error(e);} }));
    const items=[]; tasks.filter(t=>t.track==='Board'&&!t.done).forEach(t=>{ const g=grants.find(x=>x.id===t.grantId); if(g) items.push({t,g}); });
    items.sort((a,b)=>(a.t.due||'9999').localeCompare(b.t.due||'9999'));
    $('boardItems').innerHTML=items.length?'<table><tr><th>Date</th><th>Item</th><th>Grant</th><th>Meeting that decides it</th></tr>'+items.map(({t,g})=>{
      const d=t.due?diffDays(today,t.due):null; const m=t.due?ms.find(x=>x.date>=t.due||x.submitBy>=t.due):null;
      return `<tr><td class="${d!==null&&d<0?'flag-bad':(d!==null&&d<=14?'flag-warn':'')}">${t.due?fd(t.due):'<span class="flag-warn">No date</span>'}${d!==null?'<div class="small">'+(d<0?Math.abs(d)+'d overdue':'in '+d+'d')+'</div>':''}</td><td>${esc(t.title)}</td><td class="muted">${esc(g.name)}</td><td>${m?fd(m.date):'<span class="flag-bad">Not on calendar</span>'}</td></tr>`; }).join('')+'</table>':'<p class="empty">No open Board items.</p>';
    const L=lt();
    $('ltForm').innerHTML=Object.keys(DEFAULT_LT).map(k=>`<div class="field" style="flex:1; min-width:210px;"><label>${esc(LT_LABEL[k])}</label><input type="number" min="0" step="any" class="lt-in" data-k="${k}" value="${L[k]}" ${canWrite?'':'disabled'}></div>`).join('');
    $('ltForm').querySelectorAll('.lt-in').forEach(i=>i.addEventListener('change',async()=>{
      if(!db||!canWrite) return; const next=lt(); next[i.dataset.k]=Math.max(0,parseInt(i.value)||0);
      try{ await db.collection('settings').doc('leadtimes').set(next); }catch(e){console.error(e);}
    }));
  }
  $('meetingForm').addEventListener('submit',async e=>{
    e.preventDefault(); if(!db||!canWrite) return;
    try{ await db.collection('boardmeetings').add({date:$('bm-date').value,submitBy:$('bm-submit').value,note:$('bm-note').value.trim()}); e.target.reset(); }catch(x){console.error(x);}
  });

  // ================= APP CONNECTION (LEGAL AND AGENCY STAFFING) =================
  // Request submission (Legal and HR forms only) and a request tracker for Legal and Risk Management and Agency / Temporary Staffing.
  // Iframes live in panels that are NOT redrawn on every data refresh, so forms and trackers do not reload while people use them.
  const CONN_DEFAULT={ legalForm:FORM_LEGAL, agencyForm:FORM_AGENCY, legalTracker:'https://app.smartsheet.com/b/publish?EQBCT=888907e8e3644b40aee95cde7f3b4444', agencyTracker:'' };
  const connCfg=()=>Object.assign({},CONN_DEFAULT,settings.appconn||{});
  const SS_OK=u=>/^https:\/\/app\.smartsheet(gov)?\.(com|eu)\/[^\s"'<>]*$/.test(u||'');
  const LEGAL_APP_URL='https://blackknight1950.github.io/Legal/';
  const connView={ submit:null, track:'legal' };
  const connLink='text-decoration:none; padding:8px 14px; border:1px solid var(--border); border-radius:8px; color:var(--ink); font-size:13px; display:inline-block;';
  const connFrame=(url,title,h)=>SS_OK(url)
    ? `<iframe src="${esc(url)}" title="${esc(title)}" loading="lazy" style="width:100%; height:${h||760}px; border:1px solid var(--border); border-radius:10px; background:#fff;"></iframe>`
    : `<p class="empty">This link is missing or is not a Smartsheet link.</p>`;

  function renderConnSubmit(){
    const el=$('connSubmitBody'); if(!el) return; const C=connCfg();
    const items=[
      {k:'legal',dept:'Legal',title:'Legal and Risk Management request',url:C.legalForm,desc:'Contracts, subrecipient agreements, data sharing agreements or MOUs, and anything else that needs legal review before it can be signed or started.'},
      {k:'agency',dept:'HR',title:'Agency / temporary staffing request',url:C.agencyForm,desc:'Use when a grant-funded role needs agency or temporary staff while hiring is in progress or the position cannot be filled in time to spend the award.'}];
    const card=it=>`<div class="card" style="flex:1; min-width:300px;">
      <div class="muted small" style="text-transform:uppercase; letter-spacing:.08em; font-weight:700;">${esc(it.dept)}</div>
      <h2 style="margin:4px 0 6px;">${esc(it.title)}</h2>
      <p class="small muted" style="margin-bottom:12px;">${esc(it.desc)}</p>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        ${SS_OK(it.url)?`<a style="${connLink}" href="${esc(it.url)}" target="_blank" rel="noopener">Open form in a new tab</a>`:''}
        <button class="ghost conn-toggle" data-k="${it.k}" ${SS_OK(it.url)?'':'disabled'}>${connView.submit===it.k?'Hide the form':'Fill it in here'}</button>
      </div></div>`;
    const open=items.find(i=>i.k===connView.submit);
    el.innerHTML=`
      <div class="card"><h2 style="margin-bottom:6px;">App Connection (Legal and Agency Staffing)</h2>
        <p class="small muted">Submit the two requests grants need most, without leaving the app. The forms are the official CCH Smartsheet forms, so the requests land in the same Legal and Risk and Agency Staffing processes as everyone else's.</p></div>
      <div style="display:flex; gap:16px; flex-wrap:wrap;">${items.map(card).join('')}</div>
      ${open?`<div class="card"><h3 style="margin-bottom:10px;">${esc(open.title)}</h3>${connFrame(open.url,open.title,820)}</div>`:''}
      <div class="card"><h3 style="margin-bottom:6px;">After you submit</h3>
        <p class="small muted" style="margin-bottom:12px;">Log the request against the grant so its needed-by date stays tied to the award clock, then follow its progress on the Request Tracker.</p>
        <div style="display:flex; gap:8px; flex-wrap:wrap;"><button class="ghost" id="connGoReq">Log it on a grant (Requests &amp; Staffing)</button><button class="ghost" id="connGoTrack">Open the Request Tracker</button></div></div>`;
  }

  function renderConnTrack(){
    const el=$('connTrackBody'); if(!el) return;
    const a=document.activeElement; if(a&&el.contains(a)&&a.tagName==='INPUT') return; // do not disturb typing
    const C=connCfg(); const v=connView.track;
    const views=[['legal','Legal and Risk Management',C.legalTracker],['agency','Agency / Temporary Staffing',C.agencyTracker]];
    const cur=views.find(x=>x[0]===v)||views[0];
    const field=(k,label,val,hint)=>`<div class="field" style="flex:1; min-width:320px;"><label>${esc(label)}</label><input type="text" class="conn-cfg" data-k="${k}" value="${esc(val||'')}" placeholder="https://app.smartsheet.com/…" ${canWrite?'':'disabled'}><span class="small muted">${esc(hint)}</span></div>`;
    el.innerHTML=`
      <div class="card"><h2 style="margin-bottom:6px;">Request Tracker</h2>
        <p class="small muted" style="margin-bottom:12px;">Live status of Legal and Risk Management requests and Agency / Temporary Staffing requests, straight from Smartsheet. Below it, the requests your team has logged against grants in this app.</p>
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px;">
          ${views.map(x=>`<button class="${x[0]===v?'primary':'ghost'} conn-view" data-k="${x[0]}">${esc(x[1])}</button>`).join('')}
          ${SS_OK(cur[2])?`<a style="${connLink}" href="${esc(cur[2])}" target="_blank" rel="noopener">Open in a new tab</a>`:''}
          ${v==='legal'?`<a style="${connLink}" href="${LEGAL_APP_URL}" target="_blank" rel="noopener">Open the Legal and Risk app</a>`:''}
        </div>
        ${SS_OK(cur[2])?connFrame(cur[2],cur[1]+' request tracker',760)
          :`<div class="banner warn">The ${esc(cur[1])} tracker is not connected yet. In Smartsheet, open the tracker, choose <b>Share → Publish</b>, copy the link, and paste it under <b>Connection links</b> below.</div>`}
      </div>
      <div id="connLog"></div>
      <div class="card"><h3 style="margin-bottom:6px;">Connection links</h3>
        <p class="small muted" style="margin-bottom:12px;">Only Smartsheet links are accepted. Changes apply to everyone who uses the app.</p>
        <div style="display:flex; gap:14px; flex-wrap:wrap;">
          ${field('legalForm','Legal and Risk Management form',C.legalForm,'Used by Request Submission.')}
          ${field('agencyForm','HR agency / temporary staffing form',C.agencyForm,'Used by Request Submission.')}
          ${field('legalTracker','Legal and Risk Management tracker (published link)',C.legalTracker,'Smartsheet → Share → Publish.')}
          ${field('agencyTracker','Agency / temporary staffing tracker (published link)',C.agencyTracker,'Smartsheet → Share → Publish.')}
        </div><p class="small" id="connCfgMsg" style="margin-top:8px;"></p></div>`;
    renderConnLog();
  }

  function renderConnLog(){
    const el=$('connLog'); if(!el) return;
    const rows=requests.filter(r=>r.type==='Legal'||r.type==='Agency staffing').sort((a,b)=>(b.submittedAt||'').localeCompare(a.submittedAt||''));
    const closed=r=>['Complete','Declined','Closed','Approved'].includes(r.status);
    const open=rows.filter(r=>!closed(r)); const late=open.filter(r=>r.neededBy&&r.neededBy<today);
    const gname=id=>{ const g=grants.find(x=>x.id===id); return g?g.name:'(removed grant)'; };
    const pill=r=>closed(r)?`<span class="pill green">${esc(r.status)}</span>`:(r.neededBy&&r.neededBy<today?'<span class="pill red">Overdue</span>':`<span class="pill yellow">${esc(r.status||'Submitted')}</span>`);
    el.innerHTML=`<div class="card"><h3 style="margin-bottom:6px;">Logged against grants in this app</h3>
      <div class="grid-stats" style="margin-bottom:12px;">
        <div class="stat"><div class="num">${open.filter(r=>r.type==='Legal').length}</div><div class="muted small">Legal requests open</div></div>
        <div class="stat"><div class="num">${open.filter(r=>r.type==='Agency staffing').length}</div><div class="muted small">Agency staffing requests open</div></div>
        <div class="stat"><div class="num ${late.length?'bad':''}">${late.length}</div><div class="muted small">Past their needed-by date</div></div></div>
      ${rows.length?`<div class="scroll"><table style="min-width:900px;"><tr><th>Grant</th><th>Type</th><th>Request</th><th>Needed by</th><th>Submitted</th><th>Reference #</th><th>Status</th></tr>
        ${rows.map(r=>`<tr><td>${esc(gname(r.grantId))}</td><td>${esc(r.type==='Legal'?'Legal and Risk':'Agency staffing')}</td><td style="min-width:280px;">${esc(r.summary||'')}</td><td>${fd(r.neededBy)}</td><td>${fd(r.submittedAt)}</td><td>${esc(r.ref||'')}</td><td>${pill(r)}</td></tr>`).join('')}</table></div>`
        :'<p class="empty">Nothing logged yet. After you submit a form, log it on the grant (Requests &amp; Staffing) and it appears here.</p>'}</div>`;
  }

  document.addEventListener('click',e=>{
    const t=e.target.closest('.conn-toggle, .conn-view, #connGoReq, #connGoTrack'); if(!t) return;
    if(t.classList.contains('conn-toggle')){ connView.submit=connView.submit===t.dataset.k?null:t.dataset.k; renderConnSubmit(); }
    else if(t.classList.contains('conn-view')){ connView.track=t.dataset.k; renderConnTrack(); }
    else if(t.id==='connGoReq') setTab('requests');
    else if(t.id==='connGoTrack') setTab('conntrack');
  });
  document.addEventListener('change',async e=>{
    const t=e.target; if(!t.classList||!t.classList.contains('conn-cfg')) return;
    if(!db||!canWrite) return;
    const k=t.dataset.k; const val=t.value.trim(); const msg=$('connCfgMsg');
    const optional=(k==='agencyTracker'||k==='legalTracker');
    if(val===''&&!optional){ if(msg){ msg.className='small flag-bad'; msg.textContent='This link cannot be empty.'; } t.value=connCfg()[k]; return; }
    if(val!==''&&!SS_OK(val)){ if(msg){ msg.className='small flag-bad'; msg.textContent='Only https://app.smartsheet.com links are accepted.'; } return; }
    const next=Object.assign({},connCfg()); next[k]=val;
    try{ await db.collection('settings').doc('appconn').set(next); setTimeout(()=>{ const m=$('connCfgMsg'); if(m){ m.className='small flag-ok'; m.textContent='Saved.'; } },1200); logAct('','Updated App Connection link: '+k); }catch(x){ console.error(x); if(msg){ msg.className='small flag-bad'; msg.textContent='Could not save. Try again.'; } }
  });

  function renderAll(){
    renderSelects(); renderPortfolio(); renderPreview(); renderScoped(); renderPipeline(); renderApplication(); renderTemplates(); renderRisks(); renderCalendar(); renderActivity(); renderConfig(); renderConnLog();
  }
  function renderScoped(){ renderDetail(); renderSpend(); renderRequests(); renderBudget(); renderCash(); renderEffort(); renderReports(); renderSubs(); renderAmend(); renderCloseout(); }

  async function init(){
    initIntakeDefaults(); tabFromHash();
    try{ user=await claude.use('user'); db=await claude.use('db'); }catch(e){ console.error('capability init failed',e); }
    try{ if(user&&user.id) myId=String(await user.id()||''); }catch(e){}
    if(user){ try{ setWriteState(!!(await user.can('data.write'))); }catch(e){ setWriteState(false); } } else setWriteState(false);
    if(!db){ $('pfTable').innerHTML='<p class="empty">Live data isn\'t available in this view.</p>'; return; }
    db.collection('grants').onSnapshot(s=>{ grants=s.docs.map(d=>({id:d.id,...d.data()})).filter(g=>g.amount&&g.startDate&&g.endDate); renderAll(); },e=>console.error('grants',e));
    db.collection('tasks').limit(2000).onSnapshot(s=>{ tasks=s.docs.map(d=>({id:d.id,...d.data()})); renderAll(); },e=>console.error('tasks',e));
    db.collection('boardmeetings').onSnapshot(s=>{ meetings=s.docs.map(d=>({id:d.id,...d.data()})); renderAll(); },e=>console.error('meetings',e));
    db.collection('positions').onSnapshot(s=>{ positions=s.docs.map(d=>({id:d.id,...d.data()})); renderAll(); },e=>console.error('positions',e));
    db.collection('requests').onSnapshot(s=>{ requests=s.docs.map(d=>({id:d.id,...d.data()})); renderAll(); },e=>console.error('requests',e));
    db.collection('budgetlines').onSnapshot(s=>{ budgetlines=s.docs.map(d=>({id:d.id,...d.data()})); renderAll(); },e=>console.error('budgetlines',e));
    db.collection('invoices').onSnapshot(s=>{ invoices=s.docs.map(d=>({id:d.id,...d.data()})); renderAll(); },e=>console.error('invoices',e));
    db.collection('drawdowns').onSnapshot(s=>{ drawdowns=s.docs.map(d=>({id:d.id,...d.data()})); renderAll(); },e=>console.error('drawdowns',e));
    db.collection('timeeffort').onSnapshot(s=>{ timeeffort=s.docs.map(d=>({id:d.id,...d.data()})); renderAll(); },e=>console.error('timeeffort',e));
    db.collection('reports').onSnapshot(s=>{ reports=s.docs.map(d=>({id:d.id,...d.data()})); renderAll(); },e=>console.error('reports',e));
    db.collection('measures').onSnapshot(s=>{ measures=s.docs.map(d=>({id:d.id,...d.data()})); renderAll(); },e=>console.error('measures',e));
    db.collection('amendments').onSnapshot(s=>{ amendments=s.docs.map(d=>({id:d.id,...d.data()})); renderAll(); },e=>console.error('amendments',e));
    db.collection('subs').onSnapshot(s=>{ subs=s.docs.map(d=>({id:d.id,...d.data()})); renderAll(); },e=>console.error('subs',e));
    db.collection('monitoring').onSnapshot(s=>{ monitoring=s.docs.map(d=>({id:d.id,...d.data()})); renderAll(); },e=>console.error('monitoring',e));
    db.collection('opps').onSnapshot(s=>{ opps=s.docs.map(d=>({id:d.id,...d.data()})); renderAll(); },e=>console.error('opps',e));
    db.collection('templates').onSnapshot(s=>{ templates=s.docs.map(d=>({id:d.id,...d.data()})); renderAll(); },e=>console.error('templates',e));
    db.collection('activity').limit(300).onSnapshot(s=>{ activity=s.docs.map(d=>({id:d.id,...d.data()})); renderActivity(); },e=>console.error('activity',e));
    db.collection('risks').onSnapshot(s=>{ risks=s.docs.map(d=>({id:d.id,...d.data()})); renderAll(); },e=>console.error('risks',e));
    db.collection('settings').onSnapshot(s=>{ settings={}; s.docs.forEach(d=>{ if(d.id==='leadtimes') settings.leadtimes=d.data(); if(d.id==='burn') settings.burn=d.data(); if(d.id==='appconn') settings.appconn=d.data(); }); renderAll(); renderConnSubmit(); renderConnTrack(); },e=>console.error('settings',e));
  }
  init();
})();
