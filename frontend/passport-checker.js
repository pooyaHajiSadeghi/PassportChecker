(() => {
  'use strict';
  // These are the current colleague-backend requirements; they do not alter its decisions.
  function buildValidationChecks(data) {
    const a=data.analysis || {}, checks=[];
    const number=value=>typeof value==='number'&&Number.isFinite(value);
    const hasDates=number(a.age)&&number(a.months_remaining);
    const readable=hasDates&&number(a.valid_score)&&a.valid_score>=50;
    const unknown=(id,title)=>({id,title,state:'unknown',label:'Not checked',detail:'A reliable MRZ read is needed before this check can run.'});
    if(readable)checks.push({id:'mrz',title:'MRZ readability',state:'pass',label:'Passed',detail:`MRZ validation score: ${a.valid_score}. Minimum required: 50. This score does not verify the holder’s name or document authenticity.`});
    else checks.push({id:'mrz',title:'MRZ readability',state:'fail',label:'Failed',detail:'The passport MRZ and dates could not be read reliably. Try a clearer scan or check the selected page.'});
    if(readable) {
      const valid=a.months_remaining>18;
      checks.push({id:'validity',title:'Remaining passport validity',state:valid?'pass':'fail',label:valid?'Passed':'Failed',detail:`${a.months_remaining} whole months remaining. More than 18 months are required.`});
      const adult=typeof a.signature_required==='boolean'?a.signature_required:a.age>=18;
      if(typeof a.has_signature==='boolean') {
        const signatureOk=adult?a.has_signature:!a.has_signature;
        checks.push({id:'signature',title:adult?'Required signature':'Signature rule for applicants under 18',state:signatureOk?'pass':'fail',label:signatureOk?'Passed':'Failed',detail:adult?(a.has_signature?'A signature was detected.':'No signature was detected. A signature is required for applicants aged 18 or older.'):(a.has_signature?`Holder age: ${a.age}. A signature was detected, but the configured rule does not permit it under age 18.`:`Holder age: ${a.age}. No signature detected, as required by the configured rule for applicants under 18.`)});
        if(!adult)checks.push({id:'ink',title:'Blue signature ink',state:'na',label:'Not required',detail:'Blue ink is not required because applicants under 18 must not have a signature under the configured rule.'});
        else if(!a.has_signature)checks.push({id:'ink',title:'Blue signature ink',state:'skipped',label:'Not checked',detail:'The ink color cannot be evaluated because no signature was detected.'});
        else if(typeof a.is_blue==='boolean')checks.push({id:'ink',title:'Blue signature ink',state:a.is_blue?'pass':'fail',label:a.is_blue?'Passed':'Failed',detail:a.is_blue?'Blue ink was detected in the signature region.':'The detected signature was not identified as blue. A blue signature is required.'});
        else checks.push(unknown('ink','Blue signature ink'));
      } else {checks.push(unknown('signature','Signature requirement'));checks.push(unknown('ink','Blue signature ink'));}
    } else {checks.push(unknown('validity','Remaining passport validity'));checks.push(unknown('signature','Signature requirement'));checks.push(unknown('ink','Blue signature ink'));}
    checks.push({id:'extraction',title:'Holder data extraction',state:data.extraction_performed===true?'pass':'skipped',label:data.extraction_performed===true?'Completed':'Skipped',detail:data.extraction_performed===true?'The extraction phase completed. Please verify the extracted fields against the passport.':data.approved?'The server did not return extracted holder information.':'Extraction was skipped because validation did not pass. This is not an additional validation failure.',stage:true});
    return checks;
  }
  const script = document.currentScript;
  const target = document.getElementById(script.dataset.target || 'passport-checker');
  if (!target) return;
  const endpoint = script.dataset.api || '/api/passport/check/stream';
  const PDFJS_VERSION = '5.6.205';
  const PDFJS_CDNS = [
    `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/`,
    `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/`
  ];
  const root = target.attachShadow({mode:'open'});
  root.innerHTML = `
  <style>
:host{display:block;position:relative;isolation:isolate;color:#102d61;font:14px/1.6 Inter,"Segoe UI",Arial,sans-serif;color-scheme:light;min-height:100vh}
:host::before{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;background:radial-gradient(ellipse at 3% 72%,#167cf08a 0,transparent 43%),radial-gradient(ellipse at 96% 18%,#239bff80 0,transparent 42%),radial-gradient(ellipse at 50% -15%,#e9f7ff 0,transparent 60%),linear-gradient(120deg,#badfff,#e2f3ff 43%,#99ccff);}
*{box-sizing:border-box;border-radius:0}[hidden]{display:none!important}
button,input,select{font:inherit}button,input[type=file],select{cursor:pointer}button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:2px solid #006aff;outline-offset:3px}
.shell{width:min(1500px,100%);margin:0 auto;padding:30px 28px 16px}
.hero{display:grid;grid-template-columns:minmax(270px,.85fr) minmax(0,1.4fr);gap:28px;align-items:center;padding:22px 24px;border:1px solid #ffffffda;background:#f5fbff70;backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px);box-shadow:0 16px 50px #1454a21a,inset 0 1px #ffffff9c}
.eyebrow{font-size:10px;letter-spacing:2.1px;font-weight:700;color:#3870a5;margin-bottom:9px}.heading{display:flex;align-items:center;gap:13px}h1{font-size:clamp(24px,2.4vw,34px);line-height:1.15;letter-spacing:-1.1px;margin:0;color:#092561;font-weight:750}
.icon{display:grid;place-items:center;flex:0 0 42px;height:49px;color:white;background:linear-gradient(140deg,#00aaff,#0060f0);box-shadow:0 7px 20px #1472de30;font-size:25px}
p{margin:8px 0;color:#42688f}.sub{font-size:13px;max-width:390px;margin:10px 0 0 55px;line-height:1.55}
.panel{min-width:0;border:1px solid #ffffffb8;background:#f5fbff55;padding:14px}.panel form{display:grid;grid-template-columns:minmax(0,1fr) 175px;gap:0 16px;align-items:center}
.upload{display:block;grid-row:1/3;text-align:left;padding:13px 15px;border:1px solid #95c7ff;background:#eaf5ff78;transition:background .2s,border-color .2s;cursor:pointer;min-width:0}.upload:hover,.upload:focus-within,.upload.drag{background:#d4eaffd9;border-color:#006fff}.upload strong{display:block;font-size:14px;color:#103c75}.upload span{display:block;font-size:11px;color:#426b98}.upload input{display:block;width:100%;margin:8px 0;font-size:11px;color:#194e87}.upload input::file-selector-button{border:1px solid #86bdf5;background:#ffffffa3;color:#1d5c9c;padding:5px 8px;margin-right:8px;font:inherit}
.file{grid-column:2;grid-row:1;font-size:11px;overflow-wrap:anywhere;color:#315d8a;margin:0 0 8px}button{width:100%;border:1px solid #2b8eff;background:linear-gradient(120deg,#078aff,#0060f5);box-shadow:0 6px 16px #006bff29;color:white;padding:13px 10px;font-size:13px;font-weight:650;transition:filter .2s,box-shadow .2s}.panel button{grid-column:2;grid-row:2}button:hover{filter:brightness(1.06);box-shadow:0 8px 22px #006bff40}button:disabled{cursor:wait;opacity:.55;filter:none}
.page-picker{grid-column:1/-1;margin-top:12px;padding-top:12px;border-top:1px solid #a5ccef}.page-picker label{display:block;font-size:12px;font-weight:650;margin-bottom:6px}.page-picker select,.page-picker input{width:100%;max-width:320px;border:1px solid #9cc7ef;padding:9px 10px;background:#ffffffaa;color:#184a83}.page-help{font-size:11px;margin:6px 0 0}
.workspace{display:grid;grid-template-columns:minmax(0,1.06fr) minmax(0,1fr);gap:18px;align-items:start;margin-top:18px}.preview-pane,.output-pane{min-width:0;border:1px solid #ffffffcf;background:#f0f8ff66;backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);box-shadow:0 15px 45px #175ca015;overflow:hidden}
.pane-head{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:15px 20px;background:#eef8ff80;border-bottom:1px solid #ffffffb3}.pane-head h3{font-size:17px;letter-spacing:-.4px;margin:0;color:#10336d}.state-tag{font-size:10px;font-weight:650;letter-spacing:.3px;background:#e9f3ffb3;border:1px solid #a9d3ff;color:#1d61a7;padding:4px 8px;white-space:nowrap}.output-state[data-state=fail]{color:#ac2337;background:#ffeef2d6;border-color:#edb0be}.output-state[data-state=waiting]{color:#55708e;background:#f0f6ff8c;border-color:#bfd1e4}.output-state[data-state=pass],.output-state[data-state=busy]{color:#075ebd;background:#e2f0ffba;border-color:#8abcff}
.preview-stage{padding:18px;background:linear-gradient(145deg,#3769a529,#afd7f536);min-height:470px;display:grid;place-items:center;position:relative}.paper{position:relative;width:100%;aspect-ratio:.707;background:white;box-shadow:0 12px 25px #163c7233;overflow:hidden}canvas{display:block;width:100%;height:100%;object-fit:contain}.preview-empty{text-align:center;color:#54779b;padding:80px 18px}.preview-empty strong{display:block;font-size:19px;color:#244e80}.preview-empty p{font-size:13px;max-width:285px}
.scan-overlay{position:absolute;inset:0;pointer-events:none;border:1px solid #80f8ffb3;box-shadow:inset 0 0 30px #11d9ff14}.scan-line{position:absolute;top:2%;left:0;right:0;height:2px;background:#c7ffff;box-shadow:0 0 7px #00ffff,0 0 22px #00d8ff,0 0 4px #ffffff;animation:scan-pass 2.8s ease-in-out infinite alternate}.scan-line::before{content:"";position:absolute;left:0;right:0;bottom:0;height:90px;background:linear-gradient(transparent,#3de7ff38)}.scan-overlay::before,.scan-overlay::after{content:"";position:absolute;inset:10px;border:solid #8defff;border-width:1px 0;opacity:.65}.scan-overlay::after{border-width:0 1px}
.preview-progress{padding:18px 20px;background:#ecf7ff8c;border-top:1px solid #ffffffa6}.progress{margin:0;padding:0}.row{display:flex;justify-content:space-between;gap:12px;align-items:center}.stage{font-size:12px;color:#264f85}.percent{font-size:19px;font-weight:750;color:#006aff}.track{height:10px;border:1px solid #ffffffb3;background:#c5e2fb99;overflow:hidden;margin:10px 0}.fill{height:100%;width:0;background:linear-gradient(90deg,#00a7ff,#0068ff);transition:width .45s ease}.working .fill{background-size:200% 100%;background-image:linear-gradient(90deg,#0067ff,#13c6ff,#0067ff);animation:shine 2s linear infinite}.steps{display:flex;justify-content:space-between;gap:6px;font-size:10px;color:#6484a5}.steps .active{font-weight:700;color:#075fae}.preview-caption{font-size:10px;margin:9px 0 0;color:#53769b}
.output-placeholder{min-height:500px;display:grid;align-content:center;justify-items:center;text-align:center;padding:50px 25px}.placeholder-icon{font-size:34px;padding:10px 23px;color:#157bdb;border:1px solid #accfff;background:#e3f1ff88}.placeholder-title{font-size:21px;letter-spacing:-.5px;margin-top:20px}.placeholder-message{font-size:13px;max-width:310px}.busy-output .placeholder-icon{animation:soft-pulse 1.8s ease-in-out infinite}
.result{margin:0;border:0;background:transparent}.summary{padding:18px 20px;border-bottom:1px solid #ffffffb3;background:#e3f1ffb3}h2{font-size:19px;margin:0 0 5px;letter-spacing:-.4px;color:#12589f}.message{font-size:12px;line-height:1.6;margin:0;color:#42688e;white-space:pre-wrap;overflow-wrap:anywhere}.rejected .summary,.failed .summary{background:#fff0f3b3;border-bottom-color:#efb8c4}.rejected h2,.failed h2{color:#ac263d}.rejected .message,.failed .message{color:#984653}
.validation-checklist{padding:17px 18px;border-bottom:1px solid #ffffffb3}.validation-checklist h3{font-size:13px;margin:0 0 10px;color:#234d80}.check-counts{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:12px}.count{font-size:10px;font-weight:700;line-height:1.5;padding:4px 8px;border:1px solid transparent}.count.pass{color:#0865c4;background:#dbeeffa6;border-color:#9bc7fb}.count.fail{color:#b12740;background:#ffedf2aa;border-color:#efb1c1}.count.neutral{color:#5d7590;background:#edf5ff99;border-color:#bfcedf}
.check-list{list-style:none;display:grid;gap:9px;margin:0;padding:0}.check-item{display:grid;grid-template-columns:31px minmax(0,1fr);gap:11px;padding:13px;border:1px solid #9ec8f8;background:linear-gradient(110deg,#e0efffd6,#edf7ff6b);box-shadow:inset 0 1px #ffffff70}.check-icon{display:grid;place-items:center;width:30px;height:30px;font-size:18px;font-weight:750;background:#0876f2;color:white;box-shadow:0 3px 9px #0876f21a}.check-heading{display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap}.check-heading strong{font-size:13px;font-weight:650;color:#153d76}.check-label{font-size:9px;font-weight:750;letter-spacing:.7px;color:#0c66b8;text-transform:uppercase}.check-detail{font-size:11px;line-height:1.65;color:#456d98;margin:5px 0 0;overflow-wrap:anywhere}.check-item.fail{border-color:#ef9db1;background:linear-gradient(110deg,#ffe7eddd,#fff0f57a)}.fail .check-icon{background:#e83c59;color:white;box-shadow:none}.fail .check-heading strong,.fail .check-label{color:#a2243e}.fail .check-detail{color:#9c4960}.check-item.na,.check-item.skipped,.check-item.unknown{border-color:#b4cde4;background:#edf5ff6e}.na .check-icon,.skipped .check-icon,.unknown .check-icon{background:#718ea9;color:white;box-shadow:none}.na .check-label,.skipped .check-label,.unknown .check-label{color:#657b95}
.section-title{padding:18px 18px 0;margin:0;font-size:16px;letter-spacing:-.3px;color:#173f75}.extraction-note{font-size:11px;color:#547697;margin:7px 18px 0}.metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:0;padding:16px 18px}.metric{min-width:0;padding:11px 12px;border:1px solid #b7d4f0;background:#e7f3ff7d;box-shadow:inset 0 1px #ffffff66}.metric dt{font-size:10px;color:#50749c}.metric dd{font-size:15px;font-weight:650;margin:5px 0 0;color:#153f78;overflow-wrap:anywhere}.analysis-fields{padding-bottom:20px}.review-note{margin:12px 18px 0;padding:11px;font-size:12px;color:#805119;background:#fff2dbaa;border:1px solid #ecd19f}.technical-details{padding:11px 18px;border-bottom:1px solid #ffffff99;font-size:11px}.technical-details summary{cursor:pointer;color:#52759a}.technical-message{font-size:11px;white-space:pre-wrap;overflow-wrap:anywhere;color:#567392}.note{text-align:center;font-size:10px;color:#456c98;margin-top:15px}
@keyframes scan-pass{from{top:2%}to{top:98%}}@keyframes shine{to{background-position:200% 0}}@keyframes soft-pulse{50%{opacity:.4}}
@media(max-width:1100px){.hero{grid-template-columns:1fr;gap:18px}.sub{max-width:none}.shell{padding:22px 18px}.workspace{gap:14px}.panel form{grid-template-columns:minmax(0,1fr) 200px}}
@media(max-width:800px){.workspace{grid-template-columns:1fr}.hero{padding:20px}.preview-stage{min-height:300px}.paper{max-width:530px}.output-placeholder{min-height:260px}.pane-head{padding:13px 16px}.preview-progress{padding:16px}.shell{padding:16px 10px}.panel form{grid-template-columns:minmax(0,1fr) 165px}}
@media(max-width:520px){h1{font-size:27px}.hero{padding:18px 14px}.panel{padding:10px}.panel form{display:flex;flex-direction:column;align-items:stretch;gap:10px}.upload{padding:13px}.file{margin:0}.sub{margin-left:0;margin-top:12px}.page-picker{margin:0;padding-top:10px}.page-picker select,.page-picker input{max-width:none}.preview-stage{padding:10px}.check-item{padding:11px;gap:9px}.check-heading strong{font-size:12px}.metrics{gap:8px;padding:14px}.metric{padding:10px}.metric dd{font-size:14px}.state-tag{font-size:9px}.check-detail{font-size:11px}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}

.check-list{gap:6px}.check-item{padding:8px 10px}.check-detail{margin-top:3px;font-size:10px;line-height:1.45}.check-icon{width:26px;height:26px}.check-item.running{border-color:#168aff;background:#dcedff}.running .check-icon{font-size:0;background:transparent;border:2px solid #a9d2ff;border-top-color:#0876f2;border-radius:50%;animation:check-spin .8s linear infinite}.check-item.pending{opacity:.55}.check-item.revealed{animation:check-reveal .38s ease-out}.revealed .check-icon{animation:check-pop .35s ease-out}@keyframes check-spin{to{transform:rotate(360deg)}}@keyframes check-reveal{from{opacity:.3;transform:translateY(7px)}to{opacity:1;transform:none}}@keyframes check-pop{50%{transform:scale(1.18)}}@media(prefers-reduced-motion:reduce){.check-item,.check-icon{animation:none!important}}
/* Compact desktop workspace and accessible result tabs. */
:host{min-height:calc(100dvh - 16px)}
@media(min-width:801px){.holder-fields{grid-template-columns:repeat(3,minmax(0,1fr))}}
.shell{width:min(1380px,100%);padding-top:18px;padding-bottom:10px}.hero{padding:15px 18px;gap:20px}.panel{padding:10px}.upload{padding:9px 12px}.sub{font-size:12px}.workspace{grid-template-columns:minmax(0,.86fr) minmax(0,1.14fr);gap:16px;margin-top:14px;--workspace-height:600px}
.preview-pane,.output-pane{height:var(--workspace-height);display:flex;flex-direction:column}.pane-head{flex-shrink:0;padding:11px 16px}.pane-head h3{font-size:15px}.preview-stage{flex:1;min-height:0;padding:12px;display:flex;align-items:center;justify-content:center;overflow:hidden}.paper{flex:none;width:auto;height:auto;max-width:100%;max-height:100%}.preview-empty{padding:25px 15px}.preview-progress{flex-shrink:0;padding:12px 16px}.preview-caption{margin-top:6px}.percent{font-size:17px}.track{margin:7px 0;height:8px}.output-placeholder{flex:1;min-height:0;padding:30px 20px}.result{flex:1;min-height:0;display:flex;flex-direction:column}.summary{flex-shrink:0;padding:12px 16px}h2{font-size:18px}.message{font-size:11px}
.result-tabs{display:flex;flex-shrink:0;gap:0;border-bottom:1px solid #87b5e4;background:#e3f2ff77}.result-tab{flex:1;min-width:0;box-shadow:none;background:transparent;border:0;border-right:1px solid #a8cdef;border-bottom:3px solid transparent;padding:11px 8px;color:#426c96;font-size:11px;font-weight:650;line-height:1.4;white-space:normal}.result-tab:last-child{border-right:0}.result-tab:hover{background:#e5f3ffb3;box-shadow:none;filter:none}.result-tab[aria-selected=true]{background:#eef8ffbb;color:#005ec5;border-bottom-color:#0078ff}.tab-body{flex:1;min-height:0;overflow:auto;scrollbar-width:thin;scrollbar-color:#78ade0 transparent}.tab-panel{min-height:100%}.tab-panel .section-title{display:none}.validation-checklist{border:0;padding:14px 16px}.validation-checklist>h3{display:none}.check-counts{margin-bottom:11px}.check-item{padding:11px;gap:10px}.check-detail{margin-top:4px}.holder .extraction-note{margin:14px 16px 0;font-size:10px}.metrics{padding:14px 16px;gap:9px}.metric{padding:10px 11px}.metric dd{font-size:14px}.tab-empty{margin:20px;padding:18px;border:1px solid #b6cde4;background:#edf6ff80;color:#537597;font-size:13px}.technical-details{margin:0 16px 16px;padding:10px;border:1px solid #c0d8ec}.note{margin-top:9px;font-size:9px}
@media(min-width:1101px) and (max-height:800px){.shell{padding-top:12px}.hero{padding:11px 15px}.eyebrow{margin-bottom:5px}.sub{margin-top:7px}.icon{height:42px}.workspace{margin-top:10px}.preview-progress{padding:10px 14px}.check-item{padding:9px}.check-detail{font-size:10px}.check-list{gap:7px}.summary{padding:10px 14px}}
@media(max-width:1100px){.hero{gap:12px}.brand .eyebrow{display:none}.brand .heading{display:inline-flex}.sub{display:inline-block;vertical-align:middle;margin:0 0 0 18px;max-width:330px;font-size:11px}.workspace{grid-template-columns:minmax(0,.85fr) minmax(0,1.15fr)}}
@media(max-width:800px){.workspace{grid-template-columns:1fr}.preview-pane,.output-pane{height:auto}.preview-stage{flex:none;height:360px;min-height:0}.output-pane{min-height:420px}.output-placeholder{min-height:280px}.result{min-height:340px}.tab-body{overflow:visible;min-height:270px}.sub{display:block;margin:10px 0 0}.paper{max-height:100%}.shell{padding:12px 10px}.summary{padding:14px}.result-tab{padding:12px 7px}.note{font-size:9px}}
@media(max-width:520px){.preview-stage{height:310px}.result-tab{font-size:10px}.hero{padding:14px}.check-detail{font-size:11px}}
  </style>
  <section class="shell" aria-label="Passport checker">
    <div class="eyebrow">DOCUMENT REVIEW</div>
    <div class="heading"><div class="icon" aria-hidden="true">▤</div><h1>Passport Checker</h1></div>
    <p class="sub">A clear overview of your passport’s validity and signature checks.</p>
    <div class="panel">
      <form>
        <label class="upload"><strong>Choose your passport PDF</strong><span>Browse files or drag and drop a document here</span><input type="file" accept=".pdf,application/pdf" required aria-label="Passport PDF"><span>PDF only · Up to 10 MB · Choose the passport page</span></label>
        <div class="page-picker" hidden><label for="passport-page">Which page contains the passport?</label><select id="passport-page" aria-label="Passport page"><option value="">Select a page</option></select><input class="manual-page" type="number" min="1" step="1" placeholder="Enter page number" aria-label="Passport page number" hidden><p class="page-help">Select the page containing the passport information and MRZ.</p></div>
        <div class="file">No document selected</div>
        <button type="submit">Analyze passport →</button>
      </form>
      <div class="progress" hidden>
        <div class="row"><span class="stage" role="status" aria-live="polite"></span><span class="percent">0%</span></div>
        <div class="track" role="progressbar" aria-label="Passport analysis progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="fill"></div></div>
        <div class="steps"><span>Upload</span><span>Read MRZ</span><span>Signature</span><span>Complete</span></div>
      </div>
    </div>
    <section class="result" aria-live="polite" hidden><div class="summary"><h2></h2><p class="message"></p></div><section class="validation-checklist" hidden aria-label="Passport validation checklist"><h3>Requirement checks</h3><div class="check-counts"></div><ul class="check-list"></ul></section><details class="technical-details" hidden><summary>Technical response</summary><p class="technical-message"></p></details><section class="holder" hidden><h3 class="section-title">Passport holder details</h3><p class="extraction-note">Read from MRZ and printed fields. Please verify against the passport. Dates use YYYY-MM-DD; nationality is shown as a code.</p><p class="review-note" hidden></p><dl class="metrics holder-fields"></dl></section><h3 class="section-title analysis-title" hidden>Analysis details</h3><dl class="metrics analysis-fields" hidden></dl></section>
    <div class="note">Checks cover passport validity and signature requirements.</div>
  </section>`;
  const $ = selector => root.querySelector(selector);
  const input = $('input'), button = $('button'), form = $('form'), progress = $('.progress'), result = $('.result');
  const hero=document.createElement('header');hero.className='hero';
  const brand=document.createElement('div');brand.className='brand';
  brand.append($('.eyebrow'),$('.heading'),$('.sub'));hero.append(brand,$('.panel'));$('.shell').prepend(hero);
  const workspace = document.createElement('div');
  workspace.className = 'workspace';
  workspace.innerHTML = `<section class="preview-pane" aria-label="Passport preview">
    <header class="pane-head"><h3>Document preview</h3><span class="state-tag preview-state">No document</span></header>
    <div class="preview-stage"><div class="preview-empty"><strong>Your passport appears here</strong><p>Select a PDF to preview its selected page before analysis.</p></div>
      <div class="paper" hidden><canvas aria-label="Selected page of passport PDF" role="img"></canvas><div class="scan-overlay" aria-hidden="true" hidden><div class="scan-line"></div></div></div>
    </div><div class="preview-progress"><p class="preview-caption">Selected page preview · Analysis has not started</p></div>
    </section><aside class="output-pane" aria-label="Analysis output"><header class="pane-head"><h3>Analysis results</h3><span class="state-tag output-state">Waiting</span></header><div class="output-placeholder"><span class="placeholder-icon" aria-hidden="true">▤</span><strong class="placeholder-title">Ready when you are</strong><p class="placeholder-message">Upload a passport and start analysis. Extracted information and validation results will appear here.</p></div></aside>`;
  $('.hero').after(workspace);
  $('.preview-progress').prepend(progress);
  $('.output-pane').append(result);
  const tabPrefix='passport-tabs-'+Math.random().toString(36).slice(2,9);
  const nav=document.createElement('div');nav.className='result-tabs';nav.setAttribute('role','tablist');nav.setAttribute('aria-label','Passport result sections');
  const tabBody=document.createElement('div');tabBody.className='tab-body';
  const tabDefinitions=[['requirements','Requirement checks'],['holder','Passport holder details'],['analysis','Analysis details']];
  for(const [key,label] of tabDefinitions){
    const tab=document.createElement('button');tab.type='button';tab.className='result-tab';tab.id=tabPrefix+'-'+key+'-tab';tab.dataset.tab=key;tab.setAttribute('role','tab');tab.setAttribute('aria-controls',tabPrefix+'-'+key+'-panel');tab.textContent=label;
    const panel=document.createElement('section');panel.className='tab-panel';panel.id=tabPrefix+'-'+key+'-panel';panel.dataset.panel=key;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',tab.id);panel.tabIndex=0;
    nav.append(tab);tabBody.append(panel);
    tab.addEventListener('click',()=>activateTab(key));
    tab.addEventListener('keydown',event=>{
      const keys=['ArrowLeft','ArrowRight','Home','End'];if(!keys.includes(event.key))return;event.preventDefault();
      const index=tabDefinitions.findIndex(item=>item[0]===key);
      const next=event.key==='Home'?0:event.key==='End'?tabDefinitions.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabDefinitions.length)%tabDefinitions.length;
      activateTab(tabDefinitions[next][0],true);
    });
  }
  tabBody.querySelector('[data-panel=requirements]').append($('.validation-checklist'));
  tabBody.querySelector('[data-panel=holder]').append($('.holder'));
  tabBody.querySelector('[data-panel=analysis]').append($('.analysis-title'),$('.analysis-fields'),$('.technical-details'));
  for(const key of ['holder','analysis']){const empty=document.createElement('p');empty.className='tab-empty '+key+'-empty';empty.hidden=true;tabBody.querySelector('[data-panel='+key+']').append(empty);}
  const download=document.createElement('button');download.type='button';download.className='download-json';download.textContent='Download JSON';download.hidden=true;download.style.cssText='margin:0 16px 12px;padding:8px;font-size:11px';result.append(nav,tabBody,download);
  function activateTab(key,focus=false){
    for(const tab of nav.children){const selected=tab.dataset.tab===key;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;if(selected&&focus)tab.focus();}
    for(const panel of tabBody.children)panel.hidden=panel.dataset.panel!==key;
    tabBody.scrollTop=0;
  }
  activateTab('requirements');
  let pageRatio=.707;
  function fitPreview(){
    const stage=$('.preview-stage'),paper=$('.paper'),styles=getComputedStyle(stage);
    const availableWidth=Math.max(0,stage.clientWidth-parseFloat(styles.paddingLeft)-parseFloat(styles.paddingRight));
    const availableHeight=Math.max(0,stage.clientHeight-parseFloat(styles.paddingTop)-parseFloat(styles.paddingBottom));
    const width=Math.min(availableWidth,availableHeight*pageRatio);
    if(width>0){paper.style.width=width+'px';paper.style.height=(width/pageRatio)+'px';}
  }
  function layoutWorkspace(){
    const top=workspace.getBoundingClientRect().top+window.scrollY;
    const height=Math.max(420,Math.min(760,window.innerHeight-top-46));
    workspace.style.setProperty('--workspace-height',height+'px');fitPreview();
  }
  window.addEventListener('resize',layoutWorkspace,{passive:true});
  if(typeof ResizeObserver!=='undefined'){const observer=new ResizeObserver(layoutWorkspace);observer.observe(hero);observer.observe($('.preview-stage'));}
  requestAnimationFrame(layoutWorkspace);
  let busy = false, percent = 0, previewReady = false, previewVersion = 0;
  let pdfModulePromise, activeTask = null, activeRender = null, activePdf = null, pageCount = null;
  function selectedPage(){return Number($('.manual-page').hidden ? $('#passport-page').value : $('.manual-page').value);}
  function showWaiting(title, message) {
    if(!busy){$('.output-state').dataset.state='waiting';$('.output-state').textContent='Waiting';}
    $('.output-placeholder').hidden = false;
    $('.placeholder-title').textContent = title;
    $('.placeholder-message').textContent = message;
  }
  function setScanning(active) {
    if(active)$('.output-state').dataset.state='busy';
    $('.scan-overlay').hidden = !(active && previewReady);
    $('.output-pane').classList.toggle('busy-output', active);
    $('.preview-state').textContent = active ? 'Scanning' : previewReady ? 'Preview ready' : 'No preview';
    $('.output-state').textContent = active ? 'Processing' : 'Waiting';
    $('.preview-caption').textContent = active ? 'Analyzing document · Please keep this page open' : `Page ${selectedPage() || 1} preview`;
  }
  async function loadPdfEngine() {
    if (!pdfModulePromise) {
      pdfModulePromise = (async () => {
        for (const base of PDFJS_CDNS) {
          let timer;
          try {
            const pdfjs = await Promise.race([
              import(base + 'legacy/build/pdf.min.mjs'),
              new Promise((_, reject) => {timer=setTimeout(() => reject(new Error('PDF preview library timed out')), 20000);})
            ]);
            if (pdfjs.version !== PDFJS_VERSION) throw new Error('PDF preview version mismatch');
            pdfjs.GlobalWorkerOptions.workerSrc = base + 'legacy/build/pdf.worker.min.mjs';
            return {pdfjs, base};
          } catch (_) {
            // Try the same pinned release on the next CDN.
          } finally {clearTimeout(timer);}
        }
        throw new Error('Unable to load the PDF preview library.');
      })().catch(error => {pdfModulePromise=null;throw error;});
    }
    return pdfModulePromise;
  }
  async function renderSelectedPage(number, version) {
    if(activeRender){const old=activeRender;old.cancel();await old.promise.catch(()=>{});if(activeRender===old)activeRender=null;}
    if(version!==previewVersion || !activePdf)return;
    previewReady=false;$('.paper').hidden=true;$('.scan-overlay').hidden=true;$('.preview-empty').hidden=false;
    $('.preview-empty strong').textContent='Opening selected page…';
    try {
      const page=await activePdf.getPage(number);
      if(version!==previewVersion)return;
      const base=page.getViewport({scale:1});
      const scale=Math.min(1400/base.width,Math.sqrt(4000000/(base.width*base.height)));
      const viewport=page.getViewport({scale});
      const canvas=$('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      canvas.setAttribute('aria-label',`Page ${number} of selected passport PDF`);
      pageRatio=viewport.width/viewport.height;$('.paper').style.aspectRatio=String(pageRatio);fitPreview();
      const render=page.render({canvasContext:canvas.getContext('2d'),viewport});activeRender=render;
      await render.promise;
      if(version!==previewVersion)return;
      activeRender=null;previewReady=true;$('.paper').hidden=false;$('.preview-empty').hidden=true;
      $('.preview-state').textContent=busy?'Scanning':`Page ${number} of ${pageCount}`;
      $('.preview-caption').textContent=`Page ${number} of ${pageCount} · ${selectedPage()?'Ready to analyze':'Choose a page before analysis'}`;
      $('.scan-overlay').hidden=!busy;
    } catch(error) {
      if(version!==previewVersion)return;
      $('.preview-empty strong').textContent='Page preview unavailable';
      $('.preview-empty p').textContent='You may still analyze the selected page.';
    }
  }
  async function loadPreview(file) {
    const version=++previewVersion;
    pageCount=null;activePdf=null;previewReady=false;
    $('#passport-page').replaceChildren(new Option('Select a page',''));
    $('.manual-page').value='';$('.manual-page').hidden=true;$('#passport-page').hidden=false;$('.page-picker').hidden=true;
    $('.paper').hidden=true;$('.scan-overlay').hidden=true;$('.preview-empty').hidden=false;
    $('.preview-empty strong').textContent=file?'Opening PDF…':'Your passport appears here';
    $('.preview-empty p').textContent=file?'Checking the number of pages.':'Select a PDF to preview it before analysis.';
    $('.preview-state').textContent=file?'Loading':'No document';
    if(activeRender){activeRender.cancel();activeRender=null;}
    if(activeTask){await activeTask.destroy().catch(()=>{});activeTask=null;}
    if(!file || !/\.pdf$/i.test(file.name) || !file.size || file.size>10*1024*1024) {
      if(file){$('.preview-empty strong').textContent='Preview unavailable';$('.preview-empty p').textContent='Choose a non-empty PDF no larger than 10 MB.';$('.preview-state').textContent='No preview';}
      return;
    }
    try {
      const {pdfjs,base:pdfBase}=await loadPdfEngine();
      const bytes=new Uint8Array(await file.arrayBuffer());
      if(version!==previewVersion)return;
      const task=pdfjs.getDocument({data:bytes,isEvalSupported:false,wasmUrl:pdfBase+'wasm/',standardFontDataUrl:pdfBase+'standard_fonts/',cMapUrl:pdfBase+'cmaps/',cMapPacked:true});activeTask=task;
      const pdf=await task.promise;
      if(version!==previewVersion){await task.destroy();return;}
      activePdf=pdf;pageCount=pdf.numPages;
      for(let number=1;number<=pageCount;number++)$('#passport-page').add(new Option(`Page ${number} of ${pageCount}`,String(number)));
      if(pageCount===1)$('#passport-page').value='1';
      $('.page-picker').hidden=pageCount===1;
      $('.page-help').textContent=`This PDF has ${pageCount} pages. Choose the page containing the passport and MRZ.`;
      await renderSelectedPage(1,version);
    } catch(error) {
      if(version!==previewVersion)return;
      $('.preview-empty strong').textContent='Preview unavailable';
      $('.preview-empty p').textContent='Check your internet connection or enter the passport page number below to continue.';
      $('.preview-state').textContent='No preview';
      $('.page-picker').hidden=false;$('#passport-page').hidden=true;$('.manual-page').hidden=false;
      $('.page-help').textContent='Enter the passport page number (1 for a single-page PDF). The server will check this number.';
    }
  }
  $('#passport-page').addEventListener('change',()=>{
    if(busy)return;
    result.hidden=true;progress.hidden=true;showWaiting('Ready when you are','Start analysis for the selected passport page.');
    const number=selectedPage();
    if(number)void renderSelectedPage(number,++previewVersion);
  });
  $('.manual-page').addEventListener('input',()=>{if(!busy){result.hidden=true;progress.hidden=true;showWaiting('Ready when you are','Start analysis for the entered passport page.');}});
  window.addEventListener('pagehide',()=>{previewVersion++;activeRender?.cancel();activeTask?.destroy().catch(()=>{});});
  function update(value, message) {
    percent = Math.max(percent,Math.min(100,value));
    progress.hidden = false;
    $('.fill').style.width = percent + '%';
    $('.percent').textContent = percent + '%';
    $('.track').setAttribute('aria-valuenow',String(percent));
    $('.stage').textContent = message;
    if(busy && percent<100){$('.placeholder-message').textContent=message;}
    root.querySelectorAll('.steps span').forEach((step,index) => step.classList.toggle('active',percent >= [0,5,85,100][index]));
  }
  function liveChecks(value,message) {
    $('.output-placeholder').hidden=true;result.hidden=false;result.className='result';nav.hidden=false;tabBody.hidden=false;
    $('h2').textContent='Analyzing passport';$('.message').textContent=message;
    $('.download-json').hidden=true;$('.output-state').textContent='Processing';$('.check-counts').replaceChildren();
    $('.holder').hidden=true;$('.holder-empty').hidden=false;$('.holder-empty').textContent='Holder details will appear when extraction finishes.';
    $('.analysis-fields').hidden=true;$('.analysis-title').hidden=true;$('.technical-details').hidden=true;
    $('.analysis-empty').hidden=false;$('.analysis-empty').textContent='Analysis details will appear when processing finishes.';
    const items=[['PDF preparation',value<5],['Document reading',value>=5&&value<85],['Remaining passport validity',value>=85],['Signature requirement',value>=85],['Blue signature ink',value>=85],['Holder data extraction',value>=94]];
    const list=$('.check-list');
    if(list.dataset.live!=='true'){list.replaceChildren();for(const [title] of items){const row=document.createElement('li');row.innerHTML='<span class="check-icon" aria-hidden="true"></span><div><div class="check-heading"><strong></strong><span class="check-label"></span></div><p class="check-detail"></p></div>';row.querySelector('strong').textContent=title;list.append(row);}list.dataset.live='true';}
    [...list.children].forEach((row,index)=>{if(row.dataset.confirmed==='true')return;const running=items[index][1];row.className='check-item '+(running?'running':'pending');row.querySelector('.check-icon').textContent=running?'':'–';row.querySelector('.check-label').textContent=running?'Processing':'Pending';row.querySelector('.check-detail').textContent=running?'Waiting for the service to return this check’s result.':'This check has not started yet.';});
    $('.validation-checklist').hidden=false;
  }
  function receiveCheck(item) {
    const index=['upload','reading','validity','signature','ink','extraction'].indexOf(item?.id);
    if(index<0||!['pass','fail','na','skipped','unknown'].includes(item.state))return;
    if($('.check-list').dataset.live!=='true')liveChecks(percent,'Checking passport');
    const row=$('.check-list').children[index];row.dataset.confirmed='true';if(index<2)row.dataset.process='true';
    row.className='check-item '+item.state+' revealed';row.querySelector('.check-icon').textContent=item.state==='pass'?'✓':item.state==='fail'?'✕':'–';
    row.querySelector('strong').textContent=item.title;row.querySelector('.check-label').textContent=item.label;row.querySelector('.check-detail').textContent=item.detail;
    update([4,80,87,90,92,98][index],item.title+' · '+item.label);
    const rows=[...$('.check-list').children];$('.check-counts').textContent=rows.filter(row=>row.dataset.confirmed==='true').length+' / 6 steps completed';
  }
  async function revealResult(data) { display(data); }
  function renderChecks(data) {
    const checks=buildValidationChecks(data).filter(item=>item.id!=='mrz'),rules=checks.filter(item=>!item.stage);
    const passed=rules.filter(item=>item.state==='pass').length,failed=rules.filter(item=>item.state==='fail').length;
    const other=rules.length-passed-failed;
    const counts=$('.check-counts');counts.replaceChildren();
    for(const [state,text] of [['pass',`✓ ${passed} passed`],['fail',`✕ ${failed} failed`],['neutral',`${other} not required / not checked`]]) {
      if(state==='neutral'&&!other)continue;
      const badge=document.createElement('span');badge.className='count '+state;badge.textContent=text;counts.append(badge);
    }
    const list=$('.check-list');const processRows=[...list.children].filter(row=>row.dataset.process==='true');delete list.dataset.live;list.replaceChildren(...processRows);
    for(const item of checks) {
      const row=document.createElement('li'),icon=document.createElement('span'),body=document.createElement('div'),heading=document.createElement('div'),title=document.createElement('strong'),label=document.createElement('span'),detail=document.createElement('p');
      row.className='check-item '+item.state;icon.className='check-icon';icon.setAttribute('aria-hidden','true');icon.textContent=item.state==='pass'?'✓':item.state==='fail'?'✕':'–';
      heading.className='check-heading';title.textContent=item.title;label.className='check-label';label.textContent=item.label;detail.className='check-detail';detail.textContent=item.detail;
      heading.append(title,label);body.append(heading,detail);row.append(icon,body);list.append(row);
    }
    $('.validation-checklist').hidden=false;
    return {passed,failed};
  }
  function failure(message) {
    $('.output-placeholder').hidden=true;$('.output-state').textContent='Error';$('.output-state').dataset.state='fail';
    result.hidden = false; result.className = 'result failed';
    $('h2').textContent = '✕ Unable to complete analysis';
    $('.message').textContent = message;
    nav.hidden=true;tabBody.hidden=true;$('.download-json').hidden=true;
    $('.validation-checklist').hidden=true;$('.technical-details').hidden=true;
    $('.analysis-fields').hidden = true; $('.analysis-title').hidden = true; $('.holder').hidden = true;
  }
  function display(data) {
    if (typeof data.approved !== 'boolean' || typeof data.message !== 'string') throw new Error('Unexpected server response.');
    update(100,'Analysis complete');
    nav.hidden=false;tabBody.hidden=false;
    $('.output-placeholder').hidden=true;$('.output-state').textContent=data.approved?'Approved':'Needs attention';$('.output-state').dataset.state=data.approved?'pass':'fail';
    result.hidden = false; result.className = 'result' + (data.approved ? '' : ' rejected');
    $('h2').textContent = data.approved ? '✓ Passport approved' : 'Review required';
    const checkSummary=renderChecks(data);
    $('.message').textContent=data.approved?'All configured validation requirements passed.':checkSummary.failed?`${checkSummary.failed} requirement${checkSummary.failed===1?' was':'s were'} not met. See the red item${checkSummary.failed===1?'':'s'} below.`:'Validation did not pass. Review the available checks below.';
    $('.technical-details').hidden=data.approved;$('.technical-details').open=false;$('.technical-message').textContent=data.message;
    const metrics = $('.analysis-fields');metrics.replaceChildren();
    const labels = {age:'Holder age'};
    for (const [key,label] of Object.entries(labels)) {
      const value=data.analysis?.[key]; if(value==null)continue;
      const box=document.createElement('div'), dt=document.createElement('dt'),dd=document.createElement('dd');
      box.className='metric';dt.textContent=label;dd.textContent=typeof value==='boolean'?(value?'Yes':'No'):String(value);box.append(dt,dd);metrics.append(box);
    }
    if(Number.isInteger(data.page_number)){const box=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');box.className='metric';dt.textContent='Analyzed page';dd.textContent=String(data.page_number);box.append(dt,dd);metrics.append(box);}
    metrics.hidden = !metrics.children.length;
    $('.analysis-title').hidden = metrics.hidden;
    const holder = data.passport || {}, fields = $('.holder-fields'); fields.replaceChildren();
    const holderLabels = {given_names:'Given names',surname:'Surname',father_name:"Father’s name",issue_date:'Issue date',passport_number:'Passport number',nationality:'Nationality code',sex:'Sex',date_of_birth:'Date of birth',expiry_date:'Expiry date',};
    const hasData = Object.keys(holderLabels).some(key => holder[key] != null && holder[key] !== '');
    if(hasData) for(const [key,label] of Object.entries(holderLabels)) {
      const box=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');
      box.className='metric';dt.textContent=label;dd.textContent=holder[key] == null || holder[key] === '' ? 'Not available' : String(holder[key]);box.append(dt,dd);fields.append(box);
    }
    $('.holder').hidden = !hasData;
    $('.holder-empty').hidden=hasData;$('.holder-empty').textContent=data.extraction_performed===false?'Holder details are unavailable because validation did not pass and extraction was skipped.':'No holder details were returned by the analysis service.';
    $('.analysis-empty').hidden=metrics.children.length>0;$('.analysis-empty').textContent='Analysis details are unavailable because the document could not be read reliably.';
    const download=$('.download-json');download.hidden=!data.result;download.onclick=()=>{const blob=new Blob([JSON.stringify(data.result,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='passport-result.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
    activateTab('requirements');requestAnimationFrame(layoutWorkspace);
    const warnings=[...(data.result?.Warnings||[]),...(holder.extraction_warnings||[])];const notice=$('.review-note');notice.hidden=!warnings.length;notice.textContent=[...new Set(warnings)].join(' ');

  }
  function selection(){if(busy)return;const file=input.files[0];$('.file').textContent=file?`${file.name} · ${(file.size/1024/1024).toFixed(2)} MB`:'No document selected';result.hidden=true;progress.hidden=true;percent=0;$('.output-state').textContent='Waiting';showWaiting('Ready when you are','Start analysis to view extracted information and validation results.');void loadPreview(file);}
  input.addEventListener('change',selection);
  const drop = $('.upload');
  for(const type of ['dragover','dragleave','drop'])drop.addEventListener(type,event=>{event.preventDefault();drop.classList.toggle('drag',type==='dragover'&&!busy);if(type==='drop'&&!busy&&event.dataTransfer.files.length){const transfer=new DataTransfer();transfer.items.add(event.dataTransfer.files[0]);input.files=transfer.files;selection();}});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;
    const file=input.files[0];result.hidden=true;
    if(!file||!/\.pdf$/i.test(file.name))return failure('Please select a PDF file.');
    if(!file.size||file.size>10*1024*1024)return failure('Choose a non-empty PDF no larger than 10 MB.');
    const pageNumber=selectedPage();
    if(!Number.isInteger(pageNumber)||pageNumber<1)return failure(pageCount?'Please select the page containing the passport.':$('.manual-page').hidden?'Please wait for the PDF to open.':'Please enter the passport page number.');
    if(location.protocol==='file:')return failure('Open http://127.0.0.1:8000 to connect to the analysis service.');
    busy=true;button.disabled=true;input.disabled=true;$('#passport-page').disabled=true;$('.manual-page').disabled=true;button.textContent='Analyzing document…';form.setAttribute('aria-busy','true');percent=0;progress.classList.add('working');update(0,'Uploading PDF…');
    delete $('.check-list').dataset.live;liveChecks(0,'Uploading PDF…');activateTab('requirements');setScanning(true);
    let completed=false;
    try{
      const body=new FormData();body.append('file',file);body.append('page_number',String(pageNumber));
      const response=await fetch(endpoint,{method:'POST',body,headers:{Accept:'application/x-ndjson, application/json'}});
      if(!response.ok){let data;try{data=await response.json();}catch{}throw new Error(typeof data?.detail==='string'?data.detail:'The analysis service could not process this request.');}
      if(!response.headers.get('content-type')?.includes('application/x-ndjson')){await revealResult(await response.json());completed=true;}
      else{
        const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
        async function consume(line){if(!line.trim())return;const event=JSON.parse(line);if(event.type==='progress'){update(event.percent,event.message);liveChecks(event.percent,event.message);}else if(event.type==='check'){receiveCheck(event.check);}else if(event.type==='result'){await revealResult(event.result);completed=true;}else if(event.type==='error')throw new Error(event.message);}
        try{while(true){const {value,done}=await reader.read();buffer+=done?decoder.decode():decoder.decode(value,{stream:true});let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);await consume(line);}if(done)break;}if(buffer.trim())await consume(buffer);}
        finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
      }
      if(!completed)throw new Error('The connection ended before the analysis finished. Please try again.');
    }catch(error){failure(error instanceof TypeError?'Unable to reach the analysis service. Check that the server is running.':error.message);$('.stage').textContent='Analysis interrupted';}
    finally{busy=false;input.disabled=false;button.disabled=false;$('#passport-page').disabled=false;$('.manual-page').disabled=false;button.textContent='Analyze another passport →';form.removeAttribute('aria-busy');progress.classList.remove('working');setScanning(false);$('.output-state').textContent=completed?($('.result').classList.contains('rejected')?'Needs attention':'Approved'):'Error';$('.preview-caption').textContent=completed?`Analysis complete · Page ${pageNumber}`:'Analysis interrupted · You can try again';}
  });
})();
