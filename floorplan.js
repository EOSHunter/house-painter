/* 2D floor plan (after / before / changes / paint surfaces), drawn from window.HOUSE + window.ROOMS. */
(function(){
  // with several floors this page shows one at a time: ?level=0 (the ground floor, the default), 1, ...
  const LVS = window.LEVELS && window.LEVELS.length > 1 ? window.LEVELS : null;
  const LI = LVS ? Math.max(0, Math.min(LVS.length - 1, +new URLSearchParams(location.search).get('level') || 0)) : 0;
  const H = LVS ? LVS[LI].HOUSE : window.HOUSE, S = 20, ML = 80, MT = 92;
  const X = v => ML + v*S, Y = v => MT + v*S;
  const n = v => +v.toFixed(2);
  const ftin = v => { const ft=Math.floor(v+1e-6), inch=Math.round((v-ft)*12); return inch===12?`${ft+1}'-0"`:`${ft}'-${inch}"`; };
  const esc = v => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const P = H.plan || {};
  document.title = H.name + (LVS ? ' \u00b7 ' + LVS[LI].name : '') + ' \u00b7 Floor plan';
  document.getElementById('title').textContent = H.name + (LVS ? ' \u00b7 ' + LVS[LI].name : '');
  if (LVS) {                                                                   // a link to each floor
    const u = new URL(location.href), links = LVS.map((L, i) => { u.searchParams.set('level', i); return `<a href="${u.search}" class="lvlink" aria-current="${i === LI}" style="margin-right:12px;${i === LI ? 'font-weight:700;' : ''}color:inherit">${esc(L.name)}</a>`; }).join('');
    document.getElementById('subtitle').insertAdjacentHTML('afterend', `<div class="sub" id="levels">Floor: ${links}</div>`);
  }
  document.getElementById('subtitle').textContent = [H.subtitle, ftin(H.W) + ' \u00d7 ' + ftin(H.D)].filter(Boolean).join(' \u00b7 ');
  document.getElementById('floorBtn').textContent = (H.floor.name || 'Wood') + ' floor';
  document.getElementById('floorName').textContent = [H.floor.name, H.floor.spec].filter(Boolean).join(' ');
  document.getElementById('floorSw').style.background = H.floor.color;
  // plan.notes items are trusted HTML from the house file (badges, bold)
  document.getElementById('notes').innerHTML = (P.notes || []).map(c => `<div class="card"><h2>${esc(c.title)}</h2><${c.ordered ? 'ol' : 'ul'}>${c.items.map(i => '<li>' + i + '</li>').join('')}</${c.ordered ? 'ol' : 'ul'}></div>`).join('');
  const svg = document.getElementById('svg');
  let mode = 'after', floorMode = 'lvp';

  const vis = st => { st = st||'keep'; return (mode==='after'||mode==='surfaces') ? st!=='removed' : mode==='before' ? st!=='new' : true; };

  /* ---------- paint surfaces ---------- */
  const R = LVS ? LVS[LI].ROOMS : window.ROOMS;
  const roomHue = {}; R.rooms.forEach((r,i)=>{ roomHue[r.id] = (i*137.5)%360; }); roomHue.exterior = 0;
  function surfColor(s, i){ const h=roomHue[s.room]; return s.room==='exterior' ? `hsl(0 0% ${i%2?55:40}%)` : `hsl(${h} 70% ${i%2?42:58}%)`; }
  function surfacesSVG(){
    let o='', idx={};
    R.surfaces.forEach(s=>{
      const i=(idx[s.room]=(idx[s.room]||0)+1), d=s.kind==='end'?0.22:0.3;
      for(const q of (s.parts||[s])){                                          // a curved face is drawn piece by piece
        const [m0,m1]=q.normal, [[a0,b0],[a1,b1]]=q.seg;
        const pts=[[a0,b0],[a1,b1],[a1+m0*d,b1+m1*d],[a0+m0*d,b0+m1*d]].map(p=>`${n(X(p[0]))},${n(Y(p[1]))}`).join(' ');
        o+=`<polygon class="surf" data-id="${s.id}" points="${pts}" fill="${surfColor(s,i)}"><title>${s.name} \u2014 ${s.area} sq ft</title></polygon>`;
      }
      if(s.parts){ const q=s.parts[s.parts.length>>1], [[a0,b0],[a1,b1]]=q.seg; o+=`<text class="surft" x="${X((a0+a1)/2+q.normal[0]*0.75)}" y="${Y((b0+b1)/2+q.normal[1]*0.75)+2.5}">${s.id.split('-')[1]}</text>`; return; }
      const [n0,n1]=s.normal, [[x0,y0],[x1,y1]]=s.seg;
      if(s.kind==='end') return;
      const mx=(x0+x1)/2+n0*0.75, my=(y0+y1)/2+n1*0.75, vert=Math.abs(x1-x0)<0.01;
      const short=s.id.split('-')[1];
      if(s.length>=1.2) o+=`<text class="surft" x="${X(mx)}" y="${Y(my)+2.5}"${vert?` transform="rotate(-90 ${X(mx)} ${Y(my)})"`:''}>${short}</text>`;
    });
    return o;
  }
  function surfaceList(){
    const box=document.getElementById('surfRooms'); let html='';
    for(const r of [...R.rooms, {id:'exterior',name:'Exterior siding'}]){
      const list=R.surfaces.filter(s=>s.room===r.id); if(!list.length) continue;
      const tot=list.reduce((t,s)=>t+s.area,0);
      html+=`<div class="surf-room"><h3>${r.name} <span>${Math.round(tot)} sq ft</span></h3><table>`+
        list.map((s,i)=>`<tr data-id="${s.id}"><td><span class="sw" style="background:${surfColor(s,i+1)}"></span>${s.id}</td><td>${s.dir}${s.dir==='Wall end'?'':' wall'}${/\d$/.test(s.id)&&s.kind!=='end'?' '+s.id.match(/\d+$/)[0]:''}</td><td class="num">${s.length.toFixed(1)}'</td><td class="num">${Math.round(s.area)} sf</td></tr>`).join('')+'</table></div>';
    }
    box.innerHTML=html;
    document.getElementById('surfCount').textContent=`\u00b7 ${R.surfaces.length} surfaces \u00b7 ${R.rooms.length} rooms`;
    box.querySelectorAll('tr').forEach(tr=>{
      tr.addEventListener('mouseenter',()=>svg.querySelectorAll(`.surf[data-id="${tr.dataset.id}"]`).forEach(p=>p.classList.add('hot')));
      tr.addEventListener('mouseleave',()=>svg.querySelectorAll('.surf.hot').forEach(p=>p.classList.remove('hot')));
    });
  }
  const stc = st => mode!=='changes' ? '' : st==='removed' ? 'removed' : st==='new' ? 'added' : '';

  /* ---------- text ---------- */
  function text(x,y,t,o={}){
    const size=o.size||12.5, rot=o.rot?` transform="rotate(${o.rot} ${X(x)} ${Y(y)})"`:'';
    const cls=(o.cls||'room')+(o.italic?'" font-style="italic':'');
    return `<text class="${cls}" x="${X(x)}" y="${Y(y)}" font-size="${size}"${o.weight?` font-weight="${o.weight}"`:''}${rot}>${t}</text>`;
  }
  function roomLabel(l){
    const sz=l.size||12.5, step=sz*1.15;
    const lines=[l.t].concat(l.t2?[l.t2]:[]);
    let out=`<g${l.rot?` transform="rotate(${l.rot} ${X(l.x)} ${Y(l.y)})"`:''}>`;
    lines.forEach((t,i)=>{ out+=`<text class="room" font-size="${sz}" x="${X(l.x)}" y="${Y(l.y)+i*step}"${l.italic?' font-style="italic"':''}>${t}</text>`; });
    if(l.sub) out+=`<text class="rsub" x="${X(l.x)}" y="${Y(l.y)+lines.length*step+1}">${l.sub}</text>`;
    return out+'</g>';
  }

  /* ---------- walls & openings ---------- */
  function doorSVG(w,o,horiz){
    const wd=o.b-o.a, cx=(w.x0+w.x1)/2, cy=(w.y0+w.y1)/2;
    const hv=o.hinge==='a'?o.a:o.b, ov=o.hinge==='a'?o.b:o.a;
    let hx,hy,ox,oy,tx,ty;
    if(horiz){ hx=hv; hy=cy; ox=ov; oy=cy; tx=hv; ty=cy+(o.swing==='s'?wd:-wd); }
    else     { hx=cx; hy=hv; ox=cx; oy=ov; tx=cx+(o.swing==='e'?wd:-wd); ty=hv; }
    const sweep=((tx-hx)*(oy-hy)-(ty-hy)*(ox-hx))>0?1:0;
    return `<path class="swing" d="M${n(X(tx))} ${n(Y(ty))} A${n(wd*S)} ${n(wd*S)} 0 0 ${sweep} ${n(X(ox))} ${n(Y(oy))}"/>`+
           `<line class="leaf" x1="${n(X(hx))}" y1="${n(Y(hy))}" x2="${n(X(tx))}" y2="${n(Y(ty))}"/>`;
  }
  function windowSVG(w,o,horiz){
    const t=horiz?(w.y1-w.y0):(w.x1-w.x0);
    let r = horiz ? `<rect class="win" x="${X(o.a)}" y="${Y(w.y0)}" width="${(o.b-o.a)*S}" height="${t*S}"/>`
                  : `<rect class="win" x="${X(w.x0)}" y="${Y(o.a)}" width="${t*S}" height="${(o.b-o.a)*S}"/>`;
    const mid = horiz ? (w.y0+w.y1)/2 : (w.x0+w.x1)/2;
    r += horiz ? `<line class="glass" x1="${X(o.a)}" y1="${Y(mid)}" x2="${X(o.b)}" y2="${Y(mid)}"/>`
               : `<line class="glass" x1="${X(mid)}" y1="${Y(o.a)}" x2="${X(mid)}" y2="${Y(o.b)}"/>`;
    for(let i=1;i<(o.panes||1);i++){
      const p=o.a+(o.b-o.a)*i/o.panes;
      r += horiz ? `<line class="glass" x1="${X(p)}" y1="${Y(w.y0)}" x2="${X(p)}" y2="${Y(w.y1)}"/>`
                 : `<line class="glass" x1="${X(w.x0)}" y1="${Y(p)}" x2="${X(w.x1)}" y2="${Y(p)}"/>`;
    }
    return r;
  }
  // the floor: the inside of the outside walls, or (with angled walls) exactly what the rooms cover
  // (the many thin pieces of an angled outline overlap by a hair so no seams show between them)
  const floorRects=()=>H.slants.length ? H.floorRects.map(r=>[r[0]-.03,r[1]-.03,r[2]+.03,r[3]+.03]) : [[H.E,H.E,H.W-H.E,H.D-H.E]];
  /* angled walls: drawn in the wall's own frame (x along the line from its start, y to its right) */
  function slantSVG(sl){
    const c=stc(sl.status), ang=Math.atan2(sl.u[1],sl.u[0])*180/Math.PI, h=sl.t*S/2;
    const ops=sl.openings.filter(o=>o.type!=='panel').sort((p,q)=>p.a-q.a), all=sl.openings;
    let o=`<g transform="translate(${n(X(sl.p0[0]))} ${n(Y(sl.p0[1]))}) rotate(${n(ang)})">`, cur=-sl.e0;
    const piece=(a,b)=>{ if(b-a<.005) return; o+=`<rect class="wall ${c}" x="${n(a*S)}" y="${n(-h)}" width="${n((b-a)*S)}" height="${n(2*h)}"/>`; };
    ops.forEach(q=>{ piece(cur,q.a); cur=q.b; }); piece(cur,sl.len+sl.e1);
    all.filter(q=>q.type==='panel').forEach(q=>{ o+=`<rect class="panel" x="${n(q.a*S)}" y="${n(-h)}" width="${n((q.b-q.a)*S)}" height="${n(2*h)}"/>`; });
    ops.forEach(q=>{
      const wd=q.b-q.a;
      if(q.type==='window'){
        o+=`<rect class="win" x="${n(q.a*S)}" y="${n(-h)}" width="${n(wd*S)}" height="${n(2*h)}"/><line class="glass" x1="${n(q.a*S)}" y1="0" x2="${n(q.b*S)}" y2="0"/>`;
        for(let i=1;i<(q.panes||1);i++){ const p=(q.a+wd*i/q.panes)*S; o+=`<line class="glass" x1="${n(p)}" y1="${n(-h)}" x2="${n(p)}" y2="${n(h)}"/>`; }
      } else if(q.type==='door'){
        const hv=q.hinge==='b'?q.b:q.a, ov=q.hinge==='b'?q.a:q.b, dir=q.swing==='l'?-1:1;
        const hx=hv*S, ox=ov*S, tx=hx, ty=dir*wd*S, sweep=((tx-hx)*(0)-(ty)*(ox-hx))>0?1:0;
        o+=`<path class="swing" d="M${n(tx)} ${n(ty)} A${n(wd*S)} ${n(wd*S)} 0 0 ${sweep} ${n(ox)} 0"/><line class="leaf" x1="${n(hx)}" y1="0" x2="${n(tx)}" y2="${n(ty)}"/>`;
      }
    });
    return o+'</g>';
  }
  function wallSVG(w){
    const horiz=(w.x1-w.x0)>=(w.y1-w.y0), s=horiz?w.x0:w.y0, e=horiz?w.x1:w.y1;
    const all=(w.openings||[]), ops=all.filter(o=>o.type!=='panel').sort((p,q)=>p.a-q.a), c=stc(w.status);
    let out='', cur=s;
    const piece=(a,b)=>{ if(b-a<.005) return;
      out += horiz ? `<rect class="wall ${c}" x="${n(X(a))}" y="${n(Y(w.y0))}" width="${n((b-a)*S)}" height="${n((w.y1-w.y0)*S)}"/>`
                   : `<rect class="wall ${c}" x="${n(X(w.x0))}" y="${n(Y(a))}" width="${n((w.x1-w.x0)*S)}" height="${n((b-a)*S)}"/>`; };
    ops.forEach(o=>{ piece(cur,o.a); cur=o.b; });
    piece(cur,e);
    all.filter(o=>o.type==='panel').forEach(o=>{ out += horiz ? `<rect class="panel" x="${X(o.a)}" y="${Y(w.y0)}" width="${(o.b-o.a)*S}" height="${(w.y1-w.y0)*S}"/>`
                                                             : `<rect class="panel" x="${X(w.x0)}" y="${Y(o.a)}" width="${(w.x1-w.x0)*S}" height="${(o.b-o.a)*S}"/>`; });
    ops.forEach(o=>{ out += o.type==='window' ? windowSVG(w,o,horiz) : o.type==='door' ? doorSVG(w,o,horiz) : ''; });
    return out;
  }

  /* ---------- fixtures ---------- */
  function toiletSVG(f){
    const rot={w:0,n:90,e:180,s:270}[f.dir||'w'], X0=X(f.cx), Y0=Y(f.cy);
    return `<g transform="rotate(${rot} ${X0} ${Y0})">`+
      `<rect class="fxfill" x="${X0+.35*S}" y="${Y0-.55*S}" width="${.6*S}" height="${1.1*S}" rx="2"/>`+
      `<ellipse class="fxfill" cx="${X0-.1*S}" cy="${Y0}" rx="${.75*S}" ry="${.52*S}"/></g>`;
  }
  function fxSVG(f){
    switch(f.k){
      case 'box': {
        let r=`<rect class="fx ${f.c||'cabW'}" x="${X(f.x)}" y="${Y(f.y)}" width="${f.w*S}" height="${f.h*S}" rx="1"/>`;
        if(f.label) r+=`<text class="rsub" font-size="${f.size||8}" x="${X(f.x+f.w/2)}" y="${Y(f.y+f.h/2)+3}" style="fill:${f.c==='cabB'?'#fff':'var(--ink)'};font-weight:600">${f.label}</text>`;
        return r; }
      case 'stairs': {                                                               // treads across the flight, and an arrow up
        const d=f.front||'e', along=d==='e'||d==='w', n=Math.max(3,Math.round((f.rise||9)/0.6)), x=X(f.x), y=Y(f.y), w=f.w*S, h=f.h*S;
        let r=`<rect class="fx app" x="${x}" y="${y}" width="${w}" height="${h}"/>`;
        for(let i=1;i<n;i++){ const t=i/n; r+= along ? `<line class="hair" x1="${x+(d==='e'?t:1-t)*w}" y1="${y}" x2="${x+(d==='e'?t:1-t)*w}" y2="${y+h}"/>` : `<line class="hair" x1="${x}" y1="${y+(d==='s'?t:1-t)*h}" x2="${x+w}" y2="${y+(d==='s'?t:1-t)*h}"/>`; }
        const cx=x+w/2, cy=y+h/2, a=Math.min(w,h)*0.28, L={e:[1,0],w:[-1,0],s:[0,1],n:[0,-1]}[d], tx=cx+L[0]*(along?w:h)*0.38, ty=cy+L[1]*(along?w:h)*0.38, bx=cx-L[0]*(along?w:h)*0.38, by=cy-L[1]*(along?w:h)*0.38;
        return r+`<line class="hair" style="stroke-width:1.6" x1="${bx}" y1="${by}" x2="${tx}" y2="${ty}"/><polygon class="fxfill" points="${tx},${ty} ${tx-L[0]*a+L[1]*a*0.6},${ty-L[1]*a-L[0]*a*0.6} ${tx-L[0]*a-L[1]*a*0.6},${ty-L[1]*a+L[0]*a*0.6}"/><text class="rsub" font-size="7" x="${cx}" y="${cy+(along?-1:0)*0}" style="font-weight:600;fill:var(--ink)">UP</text>`; }
      case 'oval':   return `<ellipse class="fxfill" cx="${X(f.cx)}" cy="${Y(f.cy)}" rx="${f.rx*S}" ry="${f.ry*S}"/>`;
      case 'ftub':   return `<ellipse class="fxfill" cx="${X(f.cx)}" cy="${Y(f.cy)}" rx="${f.rx*S}" ry="${f.ry*S}"/>`+
                            `<ellipse class="fxt" cx="${X(f.cx)}" cy="${Y(f.cy)}" rx="${(f.rx-.25)*S}" ry="${(f.ry-.25)*S}"/>`;
      case 'toilet': return toiletSVG(f);
      case 'tub':    return `<rect class="fxfill" x="${X(f.x)}" y="${Y(f.y)}" width="${f.w*S}" height="${f.h*S}" rx="3"/>`+
                            `<rect class="fxt" x="${X(f.x+.2)}" y="${Y(f.y+.2)}" width="${(f.w-.4)*S}" height="${(f.h-.4)*S}" rx="${.55*S}"/>`;
      case 'shower': { const x=X(f.x),y=Y(f.y),w=f.w*S,h=f.h*S;
        return `<rect class="fxfill" x="${x}" y="${y}" width="${w}" height="${h}"/>`+
               `<line class="hair" x1="${x}" y1="${y}" x2="${x+w}" y2="${y+h}"/><line class="hair" x1="${x+w}" y1="${y}" x2="${x}" y2="${y+h}"/>`+
               `<circle class="fxfill" cx="${x+w/2}" cy="${y+h/2}" r="3.5"/>`; }
      case 'range':  { const x=X(f.x),y=Y(f.y),w=f.w*S,h=f.h*S; let r=`<rect class="fx app" x="${x}" y="${y}" width="${w}" height="${h}" rx="1"/>`;
        [[.28,.27],[.72,.27],[.28,.73],[.72,.73]].forEach(p=>{ r+=`<circle class="fxt" cx="${x+p[0]*w}" cy="${y+p[1]*h}" r="${Math.min(w,h)*.17}"/>`; }); return r; }
      case 'washer': return `<rect class="fx app" x="${X(f.cx-f.r-.05)}" y="${Y(f.cy-f.r-.05)}" width="${(f.r*2+.1)*S}" height="${(f.r*2+.1)*S}" rx="2"/>`+
                            `<circle class="fxt" cx="${X(f.cx)}" cy="${Y(f.cy)}" r="${f.r*S*.8}"/>`;
      case 'barn': { const w=f.x2-f.x1+.3, y=f.y+.33/2+.12, x=f.x1-.15;
        return `<line class="hair" x1="${X(x)}" y1="${Y(y-.1)}" x2="${X(x+2*w)}" y2="${Y(y-.1)}" style="stroke-width:1.4"/>`+
               `<rect class="dashed" x="${X(x+w)}" y="${Y(y)}" width="${w*S}" height="${.14*S}"/>`+
               `<rect class="fx app" x="${X(x)}" y="${Y(y)}" width="${w*S}" height="${.14*S}"/>`+
               `<text class="rsub" font-size="7" x="${X(x+w)}" y="${Y(y)+.14*S+9}">SLIDING BARN DOOR \u2192</text>`; }
      case 'heater': return `<rect class="fx app" x="${X(f.cx-f.r-.05)}" y="${Y(f.cy-f.r-.05)}" width="${(f.r*2+.1)*S}" height="${(f.r*2+.1)*S}" rx="2"/>`+
                            `<circle class="fxt" cx="${X(f.cx)}" cy="${Y(f.cy)}" r="${f.r*S*.8}"/><text class="rsub" font-size="6.5" x="${X(f.cx)}" y="${Y(f.cy)+2.5}" style="font-weight:600;fill:var(--ink)">W.H.</text>`;
      case 'pumps':  return `<rect class="fx app" x="${X(f.x)}" y="${Y(f.y)}" width="${f.w*S}" height="${f.h*S}" rx="2"/><text class="rsub" font-size="6.5" x="${X(f.x+f.w/2)}" y="${Y(f.y+f.h/2)+2.5}" style="font-weight:600;fill:var(--ink)">PUMPS</text>`;
      case 'front':  return `<rect class="fx app" x="${X(f.x)}" y="${Y(f.y)}" width="${f.w*S}" height="${f.h*S}" rx="2"/>`+
                            `<circle class="fxt" cx="${X(f.x+f.w*.62)}" cy="${Y(f.y+f.h/2)}" r="${f.h*S*.3}"/>`+
                            `<text class="rsub" font-size="6.5" x="${X(f.x+f.w*.2)}" y="${Y(f.y+f.h/2)+2.5}" style="font-weight:600;fill:var(--ink)" transform="rotate(-90 ${X(f.x+f.w*.2)} ${Y(f.y+f.h/2)})">${f.label}</text>`;
      case 'dryer':  { const x=X(f.x),y=Y(f.y),w=f.w*S,h=f.h*S;
        return `<rect class="fx app" x="${x}" y="${y}" width="${w}" height="${h}" rx="2"/><line class="hair" x1="${x}" y1="${y}" x2="${x+w}" y2="${y+h}"/><line class="hair" x1="${x+w}" y1="${y}" x2="${x}" y2="${y+h}"/>`; }
      case 'sink2':  { const w=f.w/2-.1; return [0,1].map(i=>`<rect class="fxfill" x="${X(f.x+i*(f.w/2)+.05)}" y="${Y(f.y)}" width="${w*S}" height="${f.h*S}" rx="3"/>`).join(''); }
      case 'shelf':  return `<rect class="dashed" x="${X(f.x)}" y="${Y(f.y)}" width="${f.w*S}" height="${f.h*S}"/>`+
                            `<text class="rsub" font-size="7" x="${X(f.x+f.w/2)}" y="${Y(f.y+f.h/2)}" transform="rotate(-90 ${X(f.x+f.w/2)} ${Y(f.y+f.h/2)})">${f.label||''}</text>`;
      case 'dash':   return `<line class="dashed" x1="${X(f.x1)}" y1="${Y(f.y1)}" x2="${X(f.x2)}" y2="${Y(f.y2)}"/>`+
                            (f.label?`<text class="rsub" font-size="${f.size||7}" x="${X((f.x1+f.x2)/2)}" y="${Y(f.y1)-3}">${f.label}</text>`:'');
      case 'gtub':   return `<rect class="fxfill" x="${X(f.x)}" y="${Y(f.y)}" width="${f.w*S}" height="${f.h*S}" rx="${1.2*S}"/>`+
                            `<ellipse class="fxt" cx="${X(f.x+f.w/2)}" cy="${Y(f.y+f.h/2)}" rx="${(f.w/2-.5)*S}" ry="${(f.h/2-.4)*S}"/>`;
      case 'skylight': { const x=X(f.x),y=Y(f.y),w=f.w*S,h=f.h*S;
        return `<rect class="dashed" x="${x}" y="${y}" width="${w}" height="${h}"/><text class="rsub" font-size="8" x="${x+w/2}" y="${y+h/2}" transform="rotate(-90 ${x+w/2} ${y+h/2})">SKYLIGHT</text>`; }
      case 'fireplace': { const x=X(f.x),y=Y(f.y),w=f.w*S,h=f.h*S;
        return `<rect class="fxfill" x="${x}" y="${y}" width="${w}" height="${h}"/>`+
               `<path class="fxt" d="M${x+w*.3} ${y+h*.15} L${x+w*.7} ${y+h*.15} L${x+w*.8} ${y+h*.8} L${x+w*.2} ${y+h*.8} Z"/>`+
               `<text class="rsub" font-size="8" x="${x+w/2}" y="${y+h+11}">FIREPLACE</text>`; }
      case 'arch':   return `<line class="dashed" x1="${X(f.x1)}" y1="${Y(f.y)}" x2="${X(f.x2)}" y2="${Y(f.y)}"/><text class="rsub" font-size="8" x="${X((f.x1+f.x2)/2)}" y="${Y(f.y)+14}">ARCH</text>`;
      case 'steps':  { const x=X(f.x),y=Y(f.y),w=f.w*S,h=f.h*S;
        return `<rect class="fxfill" x="${x}" y="${y}" width="${w}" height="${h}" style="fill:none"/>`+
               `<line class="hair" x1="${x}" y1="${y+h*.45}" x2="${x+w}" y2="${y+h*.45}"/><line class="hair" x1="${x}" y1="${y+h*.72}" x2="${x+w}" y2="${y+h*.72}"/>`+
               `<text class="rsub" font-size="9" x="${x+w/2}" y="${y+h*.3}" style="font-weight:600">${f.label||''}</text>`; }
      case 'deck':   return `<rect class="dashed" x="${X(f.x)}" y="${Y(f.y)}" width="${f.w*S}" height="${f.h*S}"/><text class="rsub" font-size="8" x="${X(f.x+f.w/2)}" y="${Y(f.y+f.h/2)+3}">${f.label||''}</text>`;
      case 'label':  return `<text class="rsub" font-size="${f.size||9}" x="${X(f.x)}" y="${Y(f.y)}"${f.italic?' font-style="italic"':''}>${f.t}</text>`+
                            (f.sub?`<text class="rsub" font-size="${f.size||9}" x="${X(f.x)}" y="${Y(f.y)+11}"${f.italic?' font-style="italic"':''}>${f.sub}</text>`:'');
    }
    return '';
  }

  /* ---------- dimensions ---------- */
  function dimH(x1,x2,y,label,off=0){
    const mx=(x1+x2)/2;
    return `<g><line class="dim" x1="${X(x1)}" y1="${Y(y)}" x2="${X(x2)}" y2="${Y(y)}"/>`+
      `<line class="dim" x1="${X(x1)}" y1="${Y(y)-5}" x2="${X(x1)}" y2="${Y(y)+5}"/><line class="dim" x1="${X(x2)}" y1="${Y(y)-5}" x2="${X(x2)}" y2="${Y(y)+5}"/>`+
      `<rect class="dimbg" x="${X(mx)-(label.length*3.4+6)}" y="${Y(y)-8}" width="${label.length*6.8+12}" height="16"/>`+
      `<text class="dimt" x="${X(mx)}" y="${Y(y)+4}">${label}</text></g>`;
  }
  function dimV(y1,y2,x,label){
    const my=(y1+y2)/2;
    return `<g><line class="dim" x1="${X(x)}" y1="${Y(y1)}" x2="${X(x)}" y2="${Y(y2)}"/>`+
      `<line class="dim" x1="${X(x)-5}" y1="${Y(y1)}" x2="${X(x)+5}" y2="${Y(y1)}"/><line class="dim" x1="${X(x)-5}" y1="${Y(y2)}" x2="${X(x)+5}" y2="${Y(y2)}"/>`+
      `<g transform="rotate(-90 ${X(x)} ${Y(my)})"><rect class="dimbg" x="${X(x)-(label.length*3.4+6)}" y="${Y(my)-8}" width="${label.length*6.8+12}" height="16"/>`+
      `<text class="dimt" x="${X(x)}" y="${Y(my)+4}">${label}</text></g></g>`;
  }
  const callout=(x,y,t)=>`<g class="callout"><circle cx="${X(x)}" cy="${Y(y)}" r="11"/><text x="${X(x)}" y="${Y(y)+4.5}">${t}</text></g>`;

  /* ---------- render ---------- */
  function render(){
    const Wpx = ML + H.W*S + 60, Hpx = MT + (H.D + 8.53)*S;
    svg.setAttribute('viewBox',`0 0 ${Wpx} ${Hpx}`);
    let o=`<rect class="paper" x="0" y="0" width="${Wpx}" height="${Hpx}"/>`;
    // floors
    if(floorMode==='lvp'){
      const fl=H.floor, pw=fl.plankW*S, pl=fl.plankL*S, rows=4;
      let pat=`<defs><pattern id="lvp" width="${pl}" height="${pw*rows}" patternUnits="userSpaceOnUse"><rect width="${pl}" height="${pw*rows}" fill="${fl.color}"/>`;
      for(let r=0;r<rows;r++){
        const off=(r*pl/3)%pl, y=r*pw, shade=['#ffffff','#000000'][r%2];
        pat+=`<rect y="${y}" width="${pl}" height="${pw}" fill="${shade}" opacity="${r%2?.035:.05}"/>`;
        pat+=`<line x1="0" x2="${pl}" y1="${y}" y2="${y}" stroke="#6b5636" stroke-opacity=".35" stroke-width=".7"/>`;
        pat+=`<line x1="${off}" x2="${off}" y1="${y}" y2="${y+pw}" stroke="#6b5636" stroke-opacity=".35" stroke-width=".7"/>`;
        if(off===0) continue;
      }
      pat+=`</pattern></defs>`;
      o+=pat+floorRects().map(r=>`<rect x="${n(X(r[0]))}" y="${n(Y(r[1]))}" width="${n((r[2]-r[0])*S)}" height="${n((r[3]-r[1])*S)}" fill="url(#lvp)"/>`).join('');
    } else {
      o+=floorRects().map(r=>`<rect class="f-open" x="${n(X(r[0]))}" y="${n(Y(r[1]))}" width="${n((r[2]-r[0])*S)}" height="${n((r[3]-r[1])*S)}"/>`).join('');
      H.tints.forEach(r=>{ o+=`<rect class="f-${r.k}" x="${X(r.x0)}" y="${Y(r.y0)}" width="${(r.x1-r.x0)*S}" height="${(r.y1-r.y0)*S}"/>`; });
    }
    // fixtures (outside stuff first so walls sit on top)
    H.fixtures.forEach(f=>{ if(!vis(f.st)) return; o+=`<g class="${stc(f.st)}-fx">${fxSVG(f)}</g>`; });
    // walls
    H.walls.forEach(w=>{ if(!vis(w.status)) return; o+=wallSVG(w); });
    H.slants.forEach(sl=>{ if(!vis(sl.status)) return; o+=slantSVG(sl); });
    // labels
    H.labels.forEach(l=>{ o+=roomLabel(l); });
    // houses without hand-placed labels (e.g. from the plan editor): name each room at the middle of its biggest piece
    if(!H.labels.length) R.rooms.forEach(r=>{ const big=r.shape.reduce((m,q)=>(q[2]-q[0])*(q[3]-q[1])>(m[2]-m[0])*(m[3]-m[1])?q:m, r.shape[0]); if(!big) return;
      const w=big[2]-big[0], sz=w<5?8:w<9?10:12.5; o+=roomLabel({x:(big[0]+big[2])/2, y:(big[1]+big[3])/2, t:esc(r.name.toUpperCase()), size:sz}); });
    // dimensions
    o+=dimH(0,H.W,-4.3,ftin(H.W));
    o+=dimV(0,H.D,-3.6,ftin(H.D));
    (H.voids||[]).forEach(v=>{ o+=`<rect class="dashed" x="${X(v[0])}" y="${Y(v[1])}" width="${(v[2]-v[0])*S}" height="${(v[3]-v[1])*S}"/><line class="hair" x1="${X(v[0])}" y1="${Y(v[1])}" x2="${X(v[2])}" y2="${Y(v[3])}"/><line class="hair" x1="${X(v[2])}" y1="${Y(v[1])}" x2="${X(v[0])}" y2="${Y(v[3])}"/><text class="rsub" font-size="7" x="${X((v[0]+v[2])/2)}" y="${Y((v[1]+v[3])/2)}" style="font-weight:600;fill:var(--ink)">OPEN TO BELOW</text>`; });
    (P.dims||[]).forEach(d=>{ o+= d.x1!==undefined ? dimH(d.x1,d.x2,d.y,esc(d.label||ftin(d.x2-d.x1))) : dimV(d.y1,d.y2,d.x,esc(d.label||ftin(d.y2-d.y1))); });
    (P.texts||[]).forEach(t=>{ o+=`<text class="tiny" x="${X(t.x)}" y="${Y(t.y)}">${esc(t.t)}</text>`; });
    if(mode==='changes') (P.callouts||[]).forEach(c=>{ o+=callout(c.x,c.y,esc(c.t)); });
    if(mode==='surfaces') o+=surfacesSVG();
    const sl=document.getElementById('surfList'); sl.style.display = mode==='surfaces' ? 'block' : 'none';
    if(mode==='surfaces' && !sl.dataset.ready){ sl.dataset.ready=1; setTimeout(surfaceList); }
    svg.innerHTML=o; svg.classList.toggle('lvp', floorMode==='lvp');
    document.querySelectorAll('button[data-mode]').forEach(b=>b.setAttribute('aria-pressed', b.dataset.mode===mode));
    document.querySelectorAll('button[data-floor]').forEach(b=>b.setAttribute('aria-pressed', b.dataset.floor===floorMode));
  }
  document.querySelectorAll('button[data-mode]').forEach(b=>b.addEventListener('click',()=>{ mode=b.dataset.mode; render(); }));
  document.querySelectorAll('button[data-floor]').forEach(b=>b.addEventListener('click',()=>{ floorMode=b.dataset.floor; render(); }));
  render();
})();
