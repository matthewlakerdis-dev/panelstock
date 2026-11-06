import {brandLogo} from './brand-logo.js';

const STYLE = String.raw`
/* Lennox reception: clear typography, architectural lines and restrained cyan. */
:root{--brand:#00aeef;--brand-strong:#006b92;color-scheme:light;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;color:#23313d;background:#f1f4f6;font-size:16px}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;min-height:100vh}
button,input,select,textarea{font:inherit}
button,a,input,select{-webkit-tap-highlight-color:transparent}
button,a{touch-action:manipulation}
button{cursor:pointer}
button:disabled{cursor:wait;opacity:.6}
a{color:#006b92}
button:focus,a:focus,input:focus,select:focus,summary:focus{outline:3px solid #008ab9;outline-offset:3px}
[hidden]{display:none!important}
.topbar{min-height:88px;background:#fff;border-top:3px solid #00aeef;border-bottom:1px solid #dfe5e9;padding:8px 36px;display:flex;align-items:center;justify-content:space-between}
.brand-wrap{display:flex;align-items:center;min-width:0}
.brand{display:block;min-height:44px;text-decoration:none}
.brand img{display:block;width:166px;height:66px;object-fit:contain}
.header-label{margin-left:24px;padding-left:24px;border-left:1px solid #dfe5e9;color:#64717c;font-size:12px;line-height:1.5;letter-spacing:1.5px;text-transform:uppercase;font-weight:600}
.topmeta{text-align:right;color:#63727e;font-size:12px;line-height:1.65;margin-left:24px}
.topmeta strong{display:block;font-weight:500;color:#3e4c57;font-size:13px}
main{max-width:1120px;margin:0 auto;padding:40px 32px 24px}
.kiosk{max-width:1120px;padding-top:36px}
.panel{background:#fff;border:1px solid #dfe5e9;border-radius:14px;padding:36px;box-shadow:0 8px 30px rgba(28,44,57,.035)}
.kiosk .panel{padding:36px 40px}
h1,h2,p{margin-top:0}
h1{font-size:34px;line-height:1.2;letter-spacing:-1px;margin-bottom:12px;font-weight:600}
h2{font-size:25px;line-height:1.25;letter-spacing:-.6px;margin-bottom:12px;font-weight:600}
p{line-height:1.55;margin-bottom:14px}
.subtle{color:#6a7782;font-size:14px}
.step-label,.eyebrow{color:#007da8;font-size:11px;letter-spacing:1.8px;text-transform:uppercase;font-weight:600;line-height:1.5;margin:0 0 12px}
#action-screen{padding:12px 0 8px}
#action-title{font-size:32px;letter-spacing:-.85px;margin-bottom:12px}
.wizard-intro{font-size:16px;line-height:1.6;color:#6a7782;margin:0;max-width:590px}
.attendance-actions{display:flex;margin:30px -10px 0}
.primary,.secondary,.danger,.small-button{display:inline-flex;align-items:center;justify-content:center;border:1px solid transparent;border-radius:8px;min-height:48px;padding:12px 20px;font-size:15px;font-weight:600;text-decoration:none;line-height:1.4}
.primary{background:#006b92;color:#fff}
.primary:hover{background:#005a7d}
.secondary,.small-button{background:#fff;color:#41505d;border-color:#cfd8de}
.secondary:hover,.small-button:hover{background:#f5f8fa;border-color:#adbbc5}
.danger{color:#9a413c;background:#fff;border-color:#e5cecb}
.attendance-actions .action-card{display:block;position:relative;flex:1;width:50%;min-height:230px;margin:0 10px;padding:28px;text-align:left;border-radius:12px}
.action-card.primary{background:#253440;border-color:#253440;color:#fff}
.action-card.primary:hover{background:#304452}
.action-card.secondary{background:#fff;border-color:#cbd5dc;color:#253440}
.action-card.secondary:hover{background:#f7f9fa;border-color:#9cafbd}
.action-icon{display:block;width:48px;height:48px;border-radius:10px;padding:10px;background:#eef3f6;color:#526775;margin-bottom:28px}
.action-card.primary .action-icon{background:#344956;color:#57c9f3}
.action-icon svg{display:block;width:28px;height:28px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.action-copy{display:block;padding-right:36px}
.action-copy strong{display:block;font-size:28px;letter-spacing:-.5px;line-height:1.25;font-weight:600;margin-bottom:7px}
.action-copy small{display:block;font-size:15px;font-weight:400;line-height:1.5;color:#6a7782}
.action-card.primary .action-copy small{color:#c5d2db}
.action-arrow{position:absolute;right:28px;bottom:33px;font-size:26px;font-weight:400;line-height:1}
.wizard-back{min-height:44px;padding:8px 0;border-color:transparent;background:transparent;color:#62717d;font-size:14px;margin:0 0 22px}
.wizard-back:hover{background:transparent;border-color:transparent;color:#006b92}
.wizard-back .back-arrow{font-size:19px;margin-right:8px;font-weight:400}
.wizard-heading{margin-bottom:26px}
.wizard-heading h2{font-size:28px;margin-bottom:10px;letter-spacing:-.7px}
.role-grid{display:flex;margin:0 -8px}
.role{position:relative;flex:1;width:33.333%;min-width:0;min-height:210px;margin:0 8px;background:#fff;border:1px solid #d1dbe2;border-radius:12px;padding:26px 22px;text-align:left;color:#253440}
.role:hover{background:#f7fbfd;border-color:#7db9cf}
.role[aria-pressed=true]{background:#f0faff;border-color:#008ab9;box-shadow:inset 0 0 0 1px #008ab9}
.role svg{display:block;width:32px;height:32px;stroke:#557180;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;fill:none;margin-bottom:30px}
.role strong{display:block;font-size:21px;font-weight:600;line-height:1.3;margin-bottom:8px;letter-spacing:-.35px}
.role small{display:block;font-size:14px;line-height:1.45;color:#6a7782;font-weight:400;padding-right:12px}
.role-arrow{position:absolute;right:20px;top:28px;font-size:21px;color:#8299a8;font-weight:400}
.form-heading{display:flex;align-items:flex-end;justify-content:space-between;margin:0 0 26px}
.form-heading h2{font-size:28px;margin:0;letter-spacing:-.7px}
.form-heading .step-label{margin-bottom:10px}
.form-heading>span{font-size:12px;font-weight:400;color:#63727e;margin:0 0 3px 16px;white-space:nowrap}
.fields{display:flex;flex-wrap:wrap;margin:0 -10px}
.field{display:block;width:100%;font-size:14px;line-height:1.5;color:#3d4d59;font-weight:600}
.fields>.field{width:50%;min-width:0;padding:0 10px;margin-bottom:20px}
.fields>.field.full{width:100%}
.field small{font-size:12px;font-weight:400;color:#63727e}
.field input,.field select{display:block;width:100%;min-height:56px;padding:14px 15px;margin-top:8px;border:1px solid #cbd5dc;border-radius:8px;background:#fff;color:#253440;font-size:17px;font-weight:400;line-height:1.4;-webkit-appearance:none;appearance:none}
.field input::placeholder{color:#63727e;font-weight:400;opacity:1}
.field input:focus,.field select:focus{border-color:#008ab9}
.wide{width:100%;min-height:56px;margin-top:24px;font-size:17px}
.footnote{font-size:12px;font-weight:400;line-height:1.65;text-align:center;color:#63727e;margin:14px 0 0}
.footer{display:flex;justify-content:space-between;align-items:center;padding:18px 4px 0;color:#63727e;font-size:12px;line-height:1.5}
.footer a{display:inline-flex;align-items:center;min-height:44px;padding:8px 0;color:#63727e;text-decoration:none;margin-left:16px}
.visitor-safety{margin-top:8px;padding:24px;border:1px solid #e0e7eb;border-radius:10px;background:#f7f9fa}
.visitor-safety h2{font-size:19px;letter-spacing:-.3px;margin-bottom:18px}
.safety-choice{display:flex;align-items:center;min-height:60px;padding:15px 16px;border:1px solid #cfd9e0;border-radius:8px;background:#fff;font-size:16px;font-weight:500;line-height:1.55;cursor:pointer}
.safety-choice input{display:block;flex:0 0 24px;width:24px;height:24px;min-width:24px;min-height:24px;margin:0 14px 0 0;accent-color:#006b92}
.safety-choice>span{display:block;min-width:0}
.safety-help{margin:10px 0 0;font-size:14px;color:#63727e;line-height:1.6}
.safety-question{border:0;padding:0;margin:22px 0 0;min-width:0}
.safety-question legend{font-size:16px;line-height:1.5;font-weight:600;padding:0;margin-bottom:11px;color:#3b4b57}
.safety-options{display:flex;margin:0 -6px}
.safety-options .safety-choice{flex:1;width:50%;min-width:0;margin:0 6px;font-size:16px;font-weight:500}
.safety-subsection{margin-top:24px;padding-top:22px;border-top:1px solid #dfe5e9}
.safety-subsection h3{font-size:17px;font-weight:600;line-height:1.4;letter-spacing:-.2px;margin:0 0 18px}
.safety-subsection>.safety-question:first-of-type{margin-top:0}
.safety-required{color:#b91c1c;font-weight:600}
.notice{padding:14px 16px;border:1px solid #edcfca;border-radius:8px;background:#fff6f3;color:#994c3d;font-size:14px;line-height:1.55;margin:18px 0}
.notice:empty{display:none}
#visitor-workshop-warning{margin:18px 0 0;background:#fffaf0;border-color:#ead8ad;color:#84632f}
.success{padding:42px 12px;text-align:center}
.success-symbol{display:block;width:76px;height:76px;line-height:76px;margin:0 auto 26px;border-radius:50%;background:#eaf6f0;color:#238369;font-size:36px;font-weight:400}
.success h2{font-size:31px;letter-spacing:-.8px;margin-bottom:14px}
.success>.subtle{font-size:16px;max-width:600px;margin:0 auto 10px;line-height:1.65}
#success-time{font-size:14px;color:#63727e;margin-top:14px}
.success .secondary{min-width:240px;min-height:56px;margin-top:22px;font-size:16px}
#success-workshop-warning{max-width:560px;margin:22px auto;background:#fffaf0;border-color:#ead8ad;color:#84632f}
.signout-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.signout-heading h2{font-size:28px;letter-spacing:-.7px;margin:0 16px 0 0}
#out-screen>.subtle{font-size:16px;margin-bottom:18px}
#out-screen #roster-status{font-size:13px;color:#63727e;padding-top:16px;border-top:1px solid #e5ebef;margin-bottom:0}
.results{display:flex;flex-wrap:wrap;margin:20px -7px 0}
.person{display:flex;align-items:center;justify-content:space-between;padding:20px;border:1px solid #d8e1e7;border-radius:10px;background:#fff;text-align:left;min-height:94px;font:inherit;color:#253440}
.results>.person{width:calc(100% - 14px);margin:0 7px 14px}
.person-action:hover{background:#f3faff;border-color:#89bdd1}
.person-details{min-width:0;word-wrap:break-word;overflow-wrap:break-word}
.person strong{display:block;font-size:18px;font-weight:600;line-height:1.4;margin-bottom:5px}
.person small{display:block;font-size:13px;color:#63727e;font-weight:400;line-height:1.55}
.person-action-label{flex-shrink:0;margin-left:18px;color:#006b92;font-size:14px;font-weight:600;white-space:nowrap}
.setup{max-width:570px;margin:20px auto;text-align:center}
.setup h2{font-size:26px}
.setup>.subtle{line-height:1.7}
.setup .primary{margin-top:12px}
.hero{display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:28px}
.hero .subtle{font-size:15px;margin:0}
.admin-layout{max-width:1180px}
.admin-actions,.station-buttons{display:flex;flex-wrap:wrap;margin:-4px}
.admin-actions>button,.station-buttons>*{margin:4px}
.login{max-width:460px;margin:36px auto}
.login h2{font-size:25px}
.login .field{margin-top:20px}
.stats{display:flex;flex-wrap:wrap;margin:0 -7px 10px}
.stat{width:calc(25% - 14px);margin:0 7px 14px;padding:23px 22px;border:1px solid #dfe5e9;border-radius:10px;background:#fff}
.stat span{display:block;font-size:12px;color:#63727e;margin-bottom:12px;font-weight:500}
.stat strong{font-size:32px;font-weight:600;letter-spacing:-1px;line-height:1.2}
.stat:first-child{background:#253440;border-color:#253440;color:#fff}
.stat:first-child span{color:#bfd2df}
#last-updated{font-size:12px;margin-bottom:20px}
.toolbar{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-bottom:22px}
.tabs{display:flex;margin-right:20px}
.tabs button{min-height:48px;border:0;border-bottom:2px solid transparent;background:none;padding:12px 0;color:#63727e;font-size:14px;font-weight:600}
.tabs button+button{margin-left:24px}
.tabs button[aria-pressed=true]{color:#006b92;border-bottom-color:#00aeef}
.filters{display:flex}
.filters>*+*{margin-left:9px}
.filters input,.filters select{min-height:48px;padding:10px 12px;border:1px solid #d6dfe5;border-radius:7px;background:#fff;color:#52636f;font-size:16px;font-weight:400}
.filters input{max-width:220px}
.table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid #e4e9ed;border-radius:8px}
table{width:100%;border-collapse:collapse;text-align:left;white-space:nowrap;font-size:13px}
th{padding:14px;font-size:10px;line-height:1.4;text-transform:uppercase;letter-spacing:1px;color:#63727e;background:#f6f8fa;font-weight:600;border-bottom:1px solid #e0e7ec}
td{padding:17px 14px;border-bottom:1px solid #edf1f4;color:#63727e;vertical-align:top;line-height:1.5}
tr:last-child td{border-bottom:0}
td strong{font-size:14px;color:#2d3d49;font-weight:600}
.pill{display:inline-block;padding:4px 8px;border-radius:5px;background:#edf7fc;color:#367795;font-size:11px;font-weight:500}
.pill.contractor{background:#faf4e9;color:#927345}
.pill.employee{background:#edf1f7;color:#657a98}
.visitor-safety-details{margin-top:7px;font-size:12px;white-space:normal;min-width:190px;max-width:300px}
.visitor-safety-details summary{min-height:44px;padding:11px 0;cursor:pointer;color:#45758d}
.visitor-safety-details dl{margin:0 0 8px}
.visitor-safety-details .safety-answer{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:9px}
.visitor-safety-details dt{min-width:0;margin:0 14px 0 0;font-weight:400}
.visitor-safety-details dd{flex-shrink:0;max-width:90px;text-align:right;margin:0;font-weight:500}
.follow-up-flag{display:inline-block;font-size:11px;line-height:1.5;font-weight:500;padding:5px 8px;margin:8px 0 2px 8px;border:1px solid #ead8ad;border-radius:5px;background:#fffaf0;color:#84632f}
.small-button{min-height:44px;padding:8px 12px;font-size:12px}
.empty{text-align:center;padding:48px 20px;color:#63727e;font-size:14px}
.register-footer{display:flex;align-items:center;justify-content:space-between;padding-top:20px}
.register-footer .subtle{font-size:12px}
.admin-note{font-size:12px;line-height:1.6;color:#63727e;margin:18px 0 0}
.station{margin-top:24px}
.station-top{display:flex;align-items:center;justify-content:space-between}
.station-top>div:first-child{margin-right:20px}
.station h2{font-size:20px;margin-bottom:8px}
.station .subtle{font-size:13px;margin:0}
.station-output{margin-top:24px;padding-top:22px;border-top:1px solid #e4e9ed}
.station-output input{display:block;width:100%;min-height:52px;font:16px/1.5 monospace;padding:14px;border:1px solid #d1dbe2;border-radius:7px;margin:10px 0 14px;color:#52636f;background:#f7f9fa;font-weight:400}
.station-output p{font-size:13px;line-height:1.7;color:#63727e}
.busy{opacity:.65;pointer-events:none}
.visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media(min-width:900px){.results>.person{width:calc(50% - 14px)}}
@media(max-width:900px){.header-label{display:none}.topbar{padding-right:28px;padding-left:28px}.kiosk .panel{padding:30px}.role{padding:24px 18px}.role strong{font-size:19px}.role small{font-size:13px}.hero{display:block}.hero .admin-actions{margin-top:18px}.toolbar .filters{margin-top:14px}.station-top{display:block}.station-top .admin-actions{margin-top:16px}.stat{padding:20px 16px}}
@media(max-width:680px){.topbar{min-height:78px;padding:5px 20px}.brand img{width:140px;height:56px}.topmeta{font-size:10px;margin-left:16px}.topmeta strong{font-size:11px;max-width:150px}main,.kiosk{padding:24px 16px 16px}.panel,.kiosk .panel{padding:24px 20px}#action-title{font-size:27px}.wizard-intro{font-size:15px}.attendance-actions{margin:24px -7px 0}.attendance-actions .action-card{min-height:206px;padding:22px 20px;margin:0 7px}.action-copy strong{font-size:25px}.action-copy small{font-size:13px}.action-icon{margin-bottom:24px}.action-arrow{right:20px;bottom:28px}.role-grid{display:block;margin:0}.role{display:block;width:100%;margin:0 0 12px;min-height:112px;padding:22px 52px 22px 76px}.role svg{position:absolute;left:22px;top:28px;margin:0}.role strong{font-size:20px;margin-bottom:5px}.role small{font-size:14px}.role-arrow{top:40px;right:22px}.wizard-heading h2,.form-heading h2,.signout-heading h2{font-size:25px}.form-heading{margin-bottom:22px}.fields>.field{width:100%;margin-bottom:18px}.field input,.field select{font-size:17px}.visitor-safety{padding:20px 16px}.safety-choice{padding:14px;font-size:15px}.safety-question legend{font-size:15px}.safety-help{font-size:13px}.safety-choice input{margin-right:12px}.footer{font-size:10px;padding-top:12px}.success{padding:30px 0}.success h2{font-size:28px}.success>.subtle{font-size:15px}.person{padding:17px}.person strong{font-size:17px}.person small{font-size:12px}.person-action-label{font-size:13px;margin-left:12px}.stat{width:calc(50% - 14px)}.filters{width:100%}.filters input{width:120px;max-width:none;flex:1}.filters select{width:146px}.register-footer{align-items:flex-start}.register-footer .subtle{margin-right:12px}.admin-layout .panel{padding:22px 18px}}
@media(max-width:420px){.attendance-actions{display:block;margin:24px 0 0}.attendance-actions .action-card{width:100%;min-height:174px;margin:0 0 14px;padding:22px 24px}.action-icon{margin-bottom:20px}.action-arrow{right:24px;bottom:29px}.action-copy strong{font-size:25px}.topmeta span{display:none}.safety-options{margin:0 -4px}.safety-options .safety-choice{margin:0 4px;padding:12px}}
`;

const KIOSK_BODY = String.raw`
<main class="kiosk"><h1 class="visually-hidden">Site sign-in</h1>
<section id="setup" class="panel setup" hidden><h2>This sign-in station needs to be set up</h2><p class="subtle">Ask an administrator to open a station link on this device. Visitors, contractors and employees can sign in without an account.</p><a class="primary" href="/sign-in/manage">Administrator setup <span aria-hidden="true">→</span></a></section>
<section id="station" class="panel" hidden><p id="status" class="notice" role="alert"></p>
<section id="action-screen" aria-labelledby="action-title"><p class="step-label">Step 1 of 3</p><h2 id="action-title">Sign in or out</h2><p class="wizard-intro">Please sign in when you arrive and sign out when you leave.</p><div class="attendance-actions"><button type="button" id="mode-in" class="primary action-card" aria-label="Sign in"><span class="action-icon" aria-hidden="true"><svg viewBox="0 0 28 28"><path d="M16 5h6v18h-6M4 14h13M12 9l5 5-5 5"/></svg></span><span class="action-copy"><strong>Sign in</strong><small>Arriving on site</small></span><span class="action-arrow" aria-hidden="true">→</span></button><button type="button" id="mode-out" class="secondary action-card" aria-label="Sign out"><span class="action-icon" aria-hidden="true"><svg viewBox="0 0 28 28"><path d="M12 5H6v18h6M12 14h12M19 9l5 5-5 5"/></svg></span><span class="action-copy"><strong>Sign out</strong><small>Leaving for the day</small></span><span class="action-arrow" aria-hidden="true">→</span></button></div></section>
<section id="role-screen" hidden aria-labelledby="role-title"><button id="back-to-actions-role" type="button" class="secondary wizard-back"><span class="back-arrow" aria-hidden="true">←</span>Back</button><div class="wizard-heading"><p class="step-label">Step 2 of 3</p><h2 id="role-title">How are you visiting today?</h2><p class="wizard-intro">Choose the option that applies to you.</p></div><div class="role-grid" role="group" aria-label="Select your visitor type">
<button class="role" type="button" data-role="visitor" aria-pressed="false"><span class="role-arrow" aria-hidden="true">→</span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2M18 9h5m-2.5-2.5V12"/></svg><strong>Visitor</strong><small>Meetings &amp; deliveries</small></button>
<button class="role" type="button" data-role="contractor" aria-pressed="false"><span class="role-arrow" aria-hidden="true">→</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 15h18M5 15v-3a7 7 0 0 1 14 0v3M9 6V3h6v3M3 15v4h18v-4M12 3v8"/></svg><strong>Contractor</strong><small>Work on site</small></button>
<button class="role" type="button" data-role="employee" aria-pressed="false"><span class="role-arrow" aria-hidden="true">→</span><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M9 5V2h6v3M14 11h4m-4 4h4M6 18c0-3 6-3 6 0"/><circle cx="9" cy="11" r="2"/></svg><strong>Employee</strong><small>Start your day</small></button></div>
</section>
<section id="in-screen" hidden><button id="back-to-roles" type="button" class="secondary wizard-back"><span class="back-arrow" aria-hidden="true">←</span>Back</button><form id="check-in" autocomplete="off"><div class="form-heading"><div><p class="step-label">Step 3 of 3</p><h2>Your details</h2></div><span>* Required</span></div><div class="fields">
<label class="field">Full name *<input id="name" name="name" autocapitalize="words" autocorrect="off" spellcheck="false" required maxlength="120" placeholder="Enter your full name" autocomplete="off"></label>
<label class="field" id="company-field">Company <span id="company-required" hidden>*</span> <small id="company-optional">(optional)</small><input id="company" name="company" autocapitalize="words" maxlength="160" placeholder="Company or organisation"></label>
<label class="field" id="contact-field">Phone or email <small>(optional)</small><input id="contact" name="contact" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="160" placeholder="How can we reach you?"></label>
<label class="field" id="host-field">Person you’re visiting *<input id="host" name="host" autocapitalize="words" autocorrect="off" spellcheck="false" maxlength="120" required placeholder="Your contact’s name"></label>
<label class="field full" id="purpose-field">Reason for visit *<input id="purpose" name="purpose" autocapitalize="sentences" maxlength="500" required placeholder="e.g. Meeting, maintenance or delivery"></label></div>
<section id="visitor-safety" class="visitor-safety" aria-labelledby="visitor-safety-title">
<h2 id="visitor-safety-title">Visitor safety</h2>
<label class="safety-choice safety-acknowledgement"><input id="visitor-safety-acknowledged" name="visitorSafetyAcknowledged" type="checkbox" required aria-describedby="visitor-safety-help"><span><span id="safety-acknowledgement-text">I have read and understood the visitor safety instructions provided by my host.</span> <span class="safety-required" aria-hidden="true">*</span></span></label>
<p id="visitor-safety-help" class="safety-help">Ask your host for the instructions if you have not received them.</p>
<fieldset class="safety-question"><legend><span id="workshop-access-question">Will you need access to the workshop?</span> <span class="safety-required" aria-hidden="true">*</span></legend><div class="safety-options"><label class="safety-choice"><input id="workshop-access-yes" type="radio" name="workshopAccess" value="yes" required><span>Yes</span></label><label class="safety-choice"><input id="workshop-access-no" type="radio" name="workshopAccess" value="no" required><span>No</span></label></div></fieldset>
<fieldset id="ppe-field" class="safety-question" hidden><legend><span id="ppe-confirmed-question">Do you have the required PPE for the workshop?</span> <span class="safety-required" aria-hidden="true">*</span></legend><div class="safety-options"><label class="safety-choice"><input id="ppe-confirmed-yes" type="radio" name="ppeConfirmed" value="yes" disabled><span>Yes</span></label><label class="safety-choice"><input id="ppe-confirmed-no" type="radio" name="ppeConfirmed" value="no" disabled><span>No</span></label></div></fieldset>
<div id="site-safety-questions" class="safety-subsection"><h3>Site information</h3>
<fieldset class="safety-question"><legend>Do you know the emergency evacuation procedure and assembly point? <span class="safety-required" aria-hidden="true">*</span></legend><div class="safety-options"><label class="safety-choice"><input id="emergency-procedure-understood-yes" type="radio" name="emergencyProcedureUnderstood" value="yes" required><span>Yes</span></label><label class="safety-choice"><input id="emergency-procedure-understood-no" type="radio" name="emergencyProcedureUnderstood" value="no" required><span>No</span></label></div></fieldset>
<fieldset class="safety-question"><legend>Have you been told which areas you may enter? <span class="safety-required" aria-hidden="true">*</span></legend><div class="safety-options"><label class="safety-choice"><input id="site-access-understood-yes" type="radio" name="siteAccessUnderstood" value="yes" required><span>Yes</span></label><label class="safety-choice"><input id="site-access-understood-no" type="radio" name="siteAccessUnderstood" value="no" required><span>No</span></label></div></fieldset>
<fieldset class="safety-question"><legend>Do you know who to contact if you identify a hazard or have an incident? <span class="safety-required" aria-hidden="true">*</span></legend><div class="safety-options"><label class="safety-choice"><input id="hazard-reporting-understood-yes" type="radio" name="hazardReportingUnderstood" value="yes" required><span>Yes</span></label><label class="safety-choice"><input id="hazard-reporting-understood-no" type="radio" name="hazardReportingUnderstood" value="no" required><span>No</span></label></div></fieldset>
</div>
<div id="contractor-work-field" class="safety-subsection" hidden><h3>Work on site</h3>
<fieldset class="safety-question"><legend>Will you be carrying out work on site today? <span class="safety-required" aria-hidden="true">*</span></legend><div class="safety-options"><label class="safety-choice"><input id="undertaking-work-yes" type="radio" name="undertakingWork" value="yes" disabled><span>Yes</span></label><label class="safety-choice"><input id="undertaking-work-no" type="radio" name="undertakingWork" value="no" disabled><span>No</span></label></div></fieldset>
<div id="contractor-work-questions" hidden>
<fieldset class="safety-question"><legend>Have you completed the induction required for your work on this site? <span class="safety-required" aria-hidden="true">*</span></legend><div class="safety-options"><label class="safety-choice"><input id="site-induction-completed-yes" type="radio" name="siteInductionCompleted" value="yes" disabled><span>Yes</span></label><label class="safety-choice"><input id="site-induction-completed-no" type="radio" name="siteInductionCompleted" value="no" disabled><span>No</span></label></div></fieldset>
<fieldset class="safety-question"><legend>Have today’s work activities, hazards and controls been discussed with your Lennox Facades contact? <span class="safety-required" aria-hidden="true">*</span></legend><div class="safety-options"><label class="safety-choice"><input id="work-risks-discussed-yes" type="radio" name="workRisksDiscussed" value="yes" disabled><span>Yes</span></label><label class="safety-choice"><input id="work-risks-discussed-no" type="radio" name="workRisksDiscussed" value="no" disabled><span>No</span></label></div></fieldset>
</div></div>
<p id="visitor-workshop-warning" class="notice" role="status" hidden>Speak to your host before entering the workshop.</p>
</section>
<button id="submit-in" class="primary wide" type="submit">Sign me in <span aria-hidden="true">→</span></button><p class="footnote">Your details are recorded for site attendance. Please sign out when you leave.</p></form></section>
<section id="out-screen" hidden><button id="back-to-actions-out" type="button" class="secondary wizard-back"><span class="back-arrow" aria-hidden="true">←</span>Back</button><p class="step-label">Sign out</p><div class="signout-heading"><h2>Ready to head out?</h2><button id="refresh-out" type="button" class="secondary">Refresh</button></div><p class="subtle">Tap your name below to sign out.</p><p id="roster-status" class="subtle" role="status"></p><div id="matches" class="results" aria-label="People currently signed in"></div><p class="footnote">Can’t see your name? Refresh the list or speak to your Lennox Facades contact.</p></section>
<section id="success" class="success" hidden role="status" tabindex="-1"><div class="success-symbol" aria-hidden="true">✓</div><h2 id="success-title"></h2><p id="success-message" class="subtle"></p><p id="success-time" class="subtle"></p><p id="success-workshop-warning" class="notice" hidden>Speak to your host before entering the workshop.</p><button id="next-person" type="button" class="secondary">Done · Next person</button><p class="footnote">This screen will reset in 15 seconds.</p></section></section>
<footer class="footer"><span>Lennox Facades · Site attendance</span><a href="/sign-in/manage">Staff register</a></footer></main>`;

const KIOSK_SCRIPT = String.raw`
const $=id=>document.getElementById(id),form=$('check-in'),status=$('status'),roles=[...document.querySelectorAll('[data-role]')];
let type='visitor',requestId=crypto.randomUUID(),successTimer,locked=false,kioskToken='',lastActivity=Date.now(),rosterVersion=0,rosterLoading=false;
try{kioskToken=location.hash.slice(1)||sessionStorage.getItem('panelstock-attendance-station')||'';if(location.hash){sessionStorage.setItem('panelstock-attendance-station',kioskToken);history.replaceState(null,'',location.pathname);}}catch{if(location.hash){kioskToken=location.hash.slice(1);history.replaceState(null,'',location.pathname);}}
$('setup').hidden=!!kioskToken;$('station').hidden=!kioskToken;
function time(value){return new Date(value).toLocaleTimeString('en-AU',{timeZone:'Australia/Brisbane',hour:'numeric',minute:'2-digit'});}
function setBusy(value){locked=value;document.querySelectorAll('#station button').forEach(button=>button.disabled=value);document.querySelectorAll('#station input').forEach(input=>{if(value){input.dataset.previouslyDisabled=String(input.disabled);input.disabled=true;}else if('previouslyDisabled' in input.dataset){input.disabled=input.dataset.previouslyDisabled==='true';delete input.dataset.previouslyDisabled;}});if(!value){updateVisitorSafety();if(rosterLoading)$('refresh-out').disabled=true;}}
async function request(path,body){const response=await fetch(API_BASE+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kioskToken,...body}),cache:'no-store',signal:AbortSignal.timeout(20000)});const result=await response.json();if(!response.ok||result.ok===false)throw Error(result.error||'Unable to save. Please try again.');return result;}
function textInputs(){return [...form.querySelectorAll('input')].filter(input=>!input.disabled&&input.type!=='checkbox'&&input.type!=='radio');}
function needsSafety(){return type==='visitor'||type==='contractor';}
const commonSafetyFields=[['emergencyProcedureUnderstood','emergency-procedure-understood'],['siteAccessUnderstood','site-access-understood'],['hazardReportingUnderstood','hazard-reporting-understood']],workSafetyFields=[['siteInductionCompleted','site-induction-completed'],['workRisksDiscussed','work-risks-discussed']];
function setSafetyGroup(prefix,required){['yes','no'].forEach(answer=>{const input=$(prefix+'-'+answer);input.disabled=!required;input.required=required;if(!required)input.checked=false;});}
function safetyReminder(){if(!needsSafety())return '';const contractor=type==='contractor',ppe=$('workshop-access-yes').checked&&$('ppe-confirmed-no').checked,site=commonSafetyFields.some(item=>$(item[1]+'-no').checked),work=contractor&&$('undertaking-work-yes').checked&&workSafetyFields.some(item=>$(item[1]+'-no').checked);if(contractor){if(site&&(ppe||work))return 'Speak to your Lennox Facades contact before entering the site areas or starting work.';if(ppe)return 'Speak to your Lennox Facades contact before entering the work area or starting work.';if(site)return 'Speak to your Lennox Facades contact before entering the site areas.';return work?'Speak to your Lennox Facades contact before starting work.':'';}if(site&&ppe)return 'Speak to your host before entering the site areas or workshop.';if(site)return 'Speak to your host before entering the site areas.';return ppe?'Speak to your host before entering the workshop.':'';}
function updateVisitorSafety(){const required=needsSafety(),contractor=type==='contractor',workshop=required&&$('workshop-access-yes').checked;$('visitor-safety-title').textContent=contractor?'Contractor safety':'Visitor safety';$('safety-acknowledgement-text').textContent=contractor?'I have read and understood the site safety instructions provided by my Lennox Facades contact.':'I have read and understood the visitor safety instructions provided by my host.';$('visitor-safety-help').textContent=contractor?'Ask your Lennox Facades contact for the instructions if you have not received them.':'Ask your host for the instructions if you have not received them.';$('workshop-access-question').textContent=contractor?'Will you be entering the workshop or work areas?':'Will you need access to the workshop?';$('ppe-confirmed-question').textContent=contractor?'Do you have the PPE required for your work area?':'Do you have the required PPE for the workshop?';$('visitor-safety').hidden=!required;$('visitor-safety-acknowledged').disabled=!required;$('visitor-safety-acknowledged').required=required;setSafetyGroup('workshop-access',required);$('ppe-field').hidden=!workshop;setSafetyGroup('ppe-confirmed',workshop);commonSafetyFields.forEach(item=>setSafetyGroup(item[1],required));$('contractor-work-field').hidden=!contractor;setSafetyGroup('undertaking-work',contractor);const working=contractor&&$('undertaking-work-yes').checked;$('contractor-work-questions').hidden=!working;workSafetyFields.forEach(item=>setSafetyGroup(item[1],working));const reminder=safetyReminder();$('visitor-workshop-warning').textContent=reminder;$('visitor-workshop-warning').hidden=!reminder;}
function clearVisitorSafety(){$('visitor-safety-acknowledged').checked=false;['workshop-access','ppe-confirmed','undertaking-work',...commonSafetyFields.map(item=>item[1]),...workSafetyFields.map(item=>item[1])].forEach(prefix=>{['yes','no'].forEach(answer=>{$(prefix+'-'+answer).checked=false;});});$('success-workshop-warning').hidden=true;$('success-workshop-warning').textContent='';updateVisitorSafety();}
function selectRole(value){type=value;clearVisitorSafety();roles.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.role===value)));const employee=value==='employee',contractor=value==='contractor';['company','contact','host','purpose'].forEach(id=>{$(id+'-field').hidden=employee;$(id).disabled=employee;});$('company').required=contractor;$('company-required').hidden=!contractor;$('company-optional').hidden=contractor;$('host').required=!employee;$('purpose').required=!employee;const inputs=textInputs();inputs.forEach((input,index)=>{input.enterKeyHint=index===inputs.length-1?'done':'next';});requestId=crypto.randomUUID();}
function reset(){clearTimeout(successTimer);form.reset();$('matches').replaceChildren();status.textContent='';$('success').hidden=true;selectRole('visitor');changeMode('start');}
function changeMode(value){if(locked)return;clearTimeout(successTimer);rosterVersion++;rosterLoading=false;status.textContent='';$('success').hidden=true;$('action-screen').hidden=value!=='start';$('role-screen').hidden=value!=='in';$('in-screen').hidden=true;$('out-screen').hidden=value!=='out';roles.forEach(button=>button.setAttribute('aria-pressed','false'));$('matches').replaceChildren();$('matches').setAttribute('aria-busy','false');$('roster-status').textContent='';$('refresh-out').disabled=false;form.reset();clearVisitorSafety();requestId=crypto.randomUUID();lastActivity=Date.now();if(value==='out')loadPeople(true);}
function showDetails(value){if(locked)return;selectRole(value);status.textContent='';$('role-screen').hidden=true;$('in-screen').hidden=false;lastActivity=Date.now();$('name').focus();}
function backToRoles(){if(locked)return;clearVisitorSafety();status.textContent='';$('in-screen').hidden=true;$('role-screen').hidden=false;roles.forEach(button=>button.setAttribute('aria-pressed','false'));requestId=crypto.randomUUID();lastActivity=Date.now();}
function success(entry,out=false,duplicate=false,reminder=''){rosterVersion++;rosterLoading=false;$('roster-status').textContent='';const previousVisit=!out&&!!entry.signedOutAt;$('in-screen').hidden=true;$('out-screen').hidden=true;$('success').hidden=false;status.textContent='';$('success-title').textContent=previousVisit?'This visit is already signed out':out?'You’re signed out':duplicate?'You’re already signed in':'You’re signed in';$('success-message').textContent=previousVisit?'Your previous sign-in was recorded and has since been signed out. Choose Done to sign in for a new visit.':out?'Thanks for visiting, '+entry.name+'. Have a good day.':'Thanks, '+entry.name+'. Please remember to sign out when you leave.';$('success-time').textContent=(out||previousVisit?'Signed out at ':'Signed in at ')+time(out||previousVisit?entry.signedOutAt:entry.signedInAt);form.reset();clearVisitorSafety();$('success-workshop-warning').textContent=reminder;$('success-workshop-warning').hidden=!reminder;$('matches').replaceChildren();$('success').focus();successTimer=setTimeout(reset,15000);}
for(const event of ['pointerdown','keydown','input'])document.addEventListener(event,()=>{lastActivity=Date.now();},{passive:true});setInterval(()=>{if(!locked&&Date.now()-lastActivity>=120000)reset();},10000);
roles.forEach(button=>button.addEventListener('click',()=>showDetails(button.dataset.role)));
$('back-to-roles').addEventListener('click',backToRoles);['back-to-actions-role','back-to-actions-out'].forEach(id=>$(id).addEventListener('click',reset));
$('mode-in').addEventListener('click',()=>changeMode('in'));$('mode-out').addEventListener('click',()=>changeMode('out'));$('next-person').addEventListener('click',reset);
function formChanged(){if(locked)return;updateVisitorSafety();requestId=crypto.randomUUID();status.textContent='';}
form.addEventListener('input',formChanged);form.addEventListener('change',formChanged);
form.addEventListener('keydown',event=>{if(event.key!=='Enter'||event.isComposing||locked)return;const inputs=textInputs(),index=inputs.indexOf(event.target);if(index>=0&&index<inputs.length-1){event.preventDefault();inputs[index+1].focus();}});
selectRole(type);changeMode('start');
form.addEventListener('submit',async event=>{event.preventDefault();if(locked)return;updateVisitorSafety();if(needsSafety()){let missing=!$('visitor-safety-acknowledged').checked?'visitor-safety-acknowledged':'';const groups=['workshop-access',...commonSafetyFields.map(item=>item[1])];if($('workshop-access-yes').checked)groups.push('ppe-confirmed');if(type==='contractor'){groups.push('undertaking-work');if($('undertaking-work-yes').checked)workSafetyFields.forEach(item=>groups.push(item[1]));}groups.forEach(prefix=>{if(!missing&&!$(prefix+'-yes').checked&&!$(prefix+'-no').checked)missing=prefix+'-yes';});if(missing){status.textContent='Please complete the '+(type==='contractor'?'contractor':'visitor')+' safety questions.';$(missing).focus();return;}}if(!form.checkValidity()){if(form.reportValidity)form.reportValidity();return;}const data={requestId,type,name:$('name').value.trim(),company:type==='employee'?'':$('company').value.trim(),contact:type==='employee'?'':$('contact').value.trim(),host:type==='employee'?'':$('host').value.trim(),purpose:type==='employee'?'':$('purpose').value.trim()};if(needsSafety()){data.visitorSafetyAcknowledged=true;data.workshopAccess=$('workshop-access-yes').checked;data.ppeConfirmed=data.workshopAccess?$('ppe-confirmed-yes').checked:null;commonSafetyFields.forEach(item=>{data[item[0]]=$(item[1]+'-yes').checked;});if(type==='contractor'){data.undertakingWork=$('undertaking-work-yes').checked;workSafetyFields.forEach(item=>{data[item[0]]=data.undertakingWork?$(item[1]+'-yes').checked:null;});}}const reminder=safetyReminder();setBusy(true);status.textContent='';$('submit-in').textContent='Saving sign-in…';try{const result=await request('/attendance/check-in',data);success(result.entry,false,result.duplicate,result.entry.signedOutAt?'':reminder);}catch(error){status.textContent=error.name==='TimeoutError'?'The connection timed out. Try again to confirm your sign-in.':error.message;}finally{setBusy(false);$('submit-in').textContent='Sign me in →';}});
function renderPeople(entries){
  $('matches').replaceChildren();
  $('roster-status').textContent=entries.length?entries.length+' '+(entries.length===1?'person is':'people are')+' currently signed in.':'No one is currently signed in.';
  for(const entry of entries){
    const row=document.createElement('button'),details=document.createElement('span'),name=document.createElement('strong'),info=document.createElement('small'),action=document.createElement('span');
    row.type='button';row.className='person person-action';row.setAttribute('aria-label','Sign out '+entry.name);details.className='person-details';name.textContent=entry.name;
    info.textContent=entry.type.charAt(0).toUpperCase()+entry.type.slice(1)+(entry.company?' · '+entry.company:'')+' · In at '+time(entry.signedInAt);
    action.className='person-action-label';action.textContent='Sign out';action.setAttribute('aria-hidden','true');details.append(name,info);row.append(details,action);
    const outId=crypto.randomUUID();
    row.addEventListener('click',async()=>{
      if(locked)return;setBusy(true);status.textContent='';
      try{const result=await request('/attendance/check-out',{id:entry.id,requestId:outId});success(result.entry,true);}
      catch(error){status.textContent=error.name==='TimeoutError'?'The connection timed out. Try again to confirm your sign-out.':error.message;}
      finally{setBusy(false);}
    });
    $('matches').append(row);
  }
}
async function loadPeople(force=false){
  if(locked||rosterLoading||$('out-screen').hidden||(!force&&$('matches').contains(document.activeElement)))return;
  const version=rosterVersion;rosterLoading=true;$('refresh-out').disabled=true;$('matches').setAttribute('aria-busy','true');status.textContent='';
  if(!$('matches').children.length)$('roster-status').textContent='Loading people signed in…';
  try{
    const result=await request('/attendance/lookup',{});
    if(version!==rosterVersion||$('out-screen').hidden||locked)return;
    renderPeople(result.entries);
  }catch(error){
    if(version!==rosterVersion||$('out-screen').hidden)return;
    $('matches').replaceChildren();$('roster-status').textContent='Unable to load people on site. Tap Refresh to try again.';
    status.textContent=error.name==='TimeoutError'?'The connection timed out. Please retry.':error.message;
  }finally{
    if(version===rosterVersion){rosterLoading=false;$('refresh-out').disabled=locked;$('matches').setAttribute('aria-busy','false');}
  }
}
$('refresh-out').addEventListener('click',()=>loadPeople(true));
setInterval(()=>{if(!document.hidden)loadPeople();},30000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)loadPeople();});
`;

const MANAGE_BODY = String.raw`
<main class="admin-layout"><div class="hero"><div><p class="eyebrow">Site attendance</p><h1>Sign-in register</h1><p class="subtle">Know who’s on site, and keep a record of every visit.</p></div><div id="admin-actions" class="admin-actions" hidden><button id="refresh" type="button" class="secondary">Refresh</button><button id="export" type="button" class="secondary">Export CSV</button><button id="logout" type="button" class="secondary">Log out</button></div></div>
<p id="status" class="notice" role="alert"></p><section id="login-panel" class="panel login"><h2>Administrator sign-in</h2><p class="subtle">Use your PanelStock administrator account to manage stations and view attendance.</p><form id="login"><label class="field">Username<input id="username" required maxlength="80" autocomplete="username"></label><label class="field">PIN<input id="pin" type="password" inputmode="numeric" pattern="[0-9]+" maxlength="12" required autocomplete="current-password"></label><button class="primary wide" id="login-button" type="submit">Open register <span aria-hidden="true">→</span></button></form></section>
<section id="admin" hidden><div class="stats"><div class="stat"><span>Currently on site</span><strong id="count-active">—</strong></div><div class="stat"><span>Visitors</span><strong id="count-visitors">—</strong></div><div class="stat"><span>Contractors</span><strong id="count-contractors">—</strong></div><div class="stat"><span>Employees</span><strong id="count-employees">—</strong></div></div>
<p id="last-updated" class="subtle" role="status">Refresh the register to see the latest arrivals and departures.</p>
<section class="panel"><div class="toolbar"><div class="tabs" role="group" aria-label="Register view"><button id="tab-active" type="button" aria-pressed="true">On site now</button><button id="tab-history" type="button" aria-pressed="false">Visit history</button></div><div class="filters"><input id="search" type="search" placeholder="Search name or company" aria-label="Search name or company"><select id="filter" aria-label="Filter by person type"><option value="">All people</option><option value="visitor">Visitors</option><option value="contractor">Contractors</option><option value="employee">Employees</option></select></div></div><div class="table-wrap"><table><thead><tr><th>Name</th><th>Type</th><th>Company</th><th>Host / purpose</th><th>Signed in</th><th>Signed out</th><th><span class="subtle">Action</span></th></tr></thead><tbody id="rows"></tbody></table></div><p id="empty" class="empty" hidden>No one is currently signed in.</p><div class="register-footer"><span id="record-count" class="subtle"></span><button id="load-more" type="button" class="secondary" hidden>Load more visits</button></div><p class="admin-note">Attendance is self-reported. Employee sign-in records do not verify account identity. Times are shown in Brisbane time.</p></section>
<section class="panel station"><div class="station-top"><div><h2>Sign-in station</h2><p class="subtle">Set up a separate browser or tablet for people arriving on site.</p></div><div class="admin-actions"><button id="pair" type="button" class="primary">Create station link</button><button id="revoke" type="button" class="danger">Revoke station access</button></div></div><div id="station-output" class="station-output" hidden><label class="field" for="station-link">Station link</label><input id="station-link" readonly><p>Open this link on your sign-in device. It allows attendance sign-in and sign-out only. Keep the link with authorised staff. Creating another link replaces existing station access.</p><div class="station-buttons"><button id="copy" type="button" class="secondary">Copy link</button><a id="open-station" class="primary" target="_blank" rel="noopener noreferrer">Open sign-in station <span aria-hidden="true">↗</span></a></div></div></section></section>
<footer class="footer"><span>Lennox Facades · Site attendance</span><a href="/sign-in/">Sign-in station</a></footer></main>`;

const MANAGE_SCRIPT = String.raw`
const $=id=>document.getElementById(id),status=$('status');let token='',entries=[],activeEntries=[],nextCursor=null,view='active',busy=false,authenticated=false;
try{token=sessionStorage.getItem('panelstock-attendance-admin')||'';}catch{}
function showLogin(){authenticated=false;$('login-panel').hidden=false;$('admin').hidden=true;$('admin-actions').hidden=true;entries=[];activeEntries=[];nextCursor=null;$('rows').replaceChildren();$('station-link').value='';$('open-station').removeAttribute('href');$('station-output').hidden=true;}
function clearSession(){token='';try{sessionStorage.removeItem('panelstock-attendance-admin');}catch{}showLogin();}
function setBusy(value){busy=value;document.querySelectorAll('button').forEach(button=>button.disabled=value);}
async function api(path,body,method){const response=await fetch(API_BASE+path,{method:method||(body?'POST':'GET'),headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',signal:AbortSignal.timeout(25000)});const result=await response.json();if(!response.ok||result.ok===false){if(response.status===401||response.status===403){clearSession();throw Error(path==='/login'?(result.error||'Invalid username or PIN'):response.status===403?'Administrator access is required. Sign in again.':'Your session has expired. Sign in again.');}throw Error(result.error||'Unable to load the register. Please retry.');}return result;}
function dateTime(value){return value?new Date(value).toLocaleString('en-AU',{timeZone:'Australia/Brisbane',day:'2-digit',month:'short',year:'numeric',hour:'numeric',minute:'2-digit'}):'—';}
function title(value){return value.charAt(0).toUpperCase()+value.slice(1);}
function filtered(values){const search=$('search').value.trim().toLowerCase(),role=$('filter').value;return values.filter(entry=>(!role||entry.type===role)&&(!search||(entry.name+' '+entry.company).toLowerCase().includes(search)));}
function safetyAnswer(entry,key){if(entry.type!=='visitor'&&entry.type!=='contractor')return 'Not applicable';if(['undertakingWork','siteInductionCompleted','workRisksDiscussed'].indexOf(key)>=0&&entry.type!=='contractor')return 'Not applicable';if((key==='siteInductionCompleted'||key==='workRisksDiscussed')&&entry.undertakingWork===false)return 'Not applicable';if(key==='ppeConfirmed'&&entry.workshopAccess===false)return 'Not applicable';return entry[key]===true?'Yes':entry[key]===false?'No':'Not collected';}
function safetyFollowUp(entry){if(entry.type!=='visitor'&&entry.type!=='contractor')return 'Not applicable';const answers=[entry.visitorSafetyAcknowledged,entry.emergencyProcedureUnderstood,entry.siteAccessUnderstood,entry.hazardReportingUnderstood];if(entry.workshopAccess===true)answers.push(entry.ppeConfirmed);else if(entry.workshopAccess!==false)answers.push(null);if(entry.type==='contractor'){if(entry.undertakingWork===true)answers.push(entry.siteInductionCompleted,entry.workRisksDiscussed);else if(entry.undertakingWork!==false)answers.push(null);}return answers.some(value=>value===false)?'Yes':answers.every(value=>value===true)?'No':'Not collected';}
function render(){const all=view==='active'?activeEntries:entries,rows=filtered(all);$('rows').replaceChildren();for(const entry of rows){const tr=document.createElement('tr'),name=document.createElement('td'),strong=document.createElement('strong');strong.textContent=entry.name;name.append(strong);if(entry.type==='visitor'||entry.type==='contractor'){const followUp=safetyFollowUp(entry);if(followUp==='Yes'){const flag=document.createElement('span');flag.className='follow-up-flag';flag.textContent='Staff follow-up';name.append(flag);}const details=document.createElement('details'),summary=document.createElement('summary'),answers=document.createElement('dl');details.className='visitor-safety-details';summary.textContent=title(entry.type)+' safety';details.append(summary);for(const item of [['Safety acknowledged','visitorSafetyAcknowledged'],['Workshop / work area access','workshopAccess'],['PPE confirmed','ppeConfirmed'],['Emergency procedure understood','emergencyProcedureUnderstood'],['Site access understood','siteAccessUnderstood'],['Hazard reporting understood','hazardReportingUnderstood'],['Undertaking work','undertakingWork'],['Site induction completed','siteInductionCompleted'],['Work risks discussed','workRisksDiscussed'],['Staff follow-up','staffFollowUp']]){const pair=document.createElement('div'),label=document.createElement('dt'),answer=document.createElement('dd');pair.className='safety-answer';label.textContent=item[0];answer.textContent=item[1]==='staffFollowUp'?followUp:safetyAnswer(entry,item[1]);pair.append(label,answer);answers.append(pair);}details.append(answers);name.append(details);}const role=document.createElement('td'),pill=document.createElement('span');pill.className='pill '+entry.type;pill.textContent=title(entry.type);role.append(pill);tr.append(name,role);for(const text of [entry.company||'—',[entry.host,entry.purpose].filter(Boolean).join(' · ')||'—',dateTime(entry.signedInAt),dateTime(entry.signedOutAt)]){const td=document.createElement('td');td.textContent=text;tr.append(td);}const action=document.createElement('td');if(!entry.signedOutAt){const button=document.createElement('button');button.type='button';button.className='small-button';button.textContent='Sign out';button.addEventListener('click',()=>adminCheckOut(entry));action.append(button);}else action.textContent='—';tr.append(action);$('rows').append(tr);}$('empty').hidden=rows.length>0;$('empty').textContent=all.length?'No records match your filters.':view==='active'?'No one is currently signed in.':'No attendance records yet.';$('record-count').textContent=rows.length+' '+(rows.length===1?'record':'records')+(view==='history'&&nextCursor?' shown · More visits available':'');$('load-more').hidden=view!=='history'||!nextCursor;}
function apply(result,append=false){$('last-updated').textContent='Updated '+new Date().toLocaleTimeString('en-AU',{timeZone:'Australia/Brisbane',hour:'numeric',minute:'2-digit',second:'2-digit'})+' · Use Refresh for the latest attendance.';entries=append?[...entries,...result.entries]:result.entries;activeEntries=result.activeEntries;nextCursor=result.nextCursor||null;for(const key of ['active','visitors','contractors','employees'])$('count-'+key).textContent=String(result.counts[key]||0);render();}
async function load(append=false){const result=append?await api('/attendance/register',{cursor:nextCursor,limit:100}):await api('/attendance/register');apply(result,append);}
async function action(fn){if(busy)return;setBusy(true);status.textContent='';try{await fn();}catch(error){status.textContent=error.name==='TimeoutError'?'The connection timed out. Please retry.':error.message;}finally{setBusy(false);}}
async function adminCheckOut(entry){if(!confirm('Sign out '+entry.name+' now?'))return;await action(async()=>{await api('/attendance/admin-check-out',{id:entry.id});await load();});}
function openRegister(){authenticated=true;$('login-panel').hidden=true;$('admin').hidden=false;$('admin-actions').hidden=false;}
$('login').addEventListener('submit',event=>{event.preventDefault();action(async()=>{const result=await api('/login',{username:$('username').value.trim(),pin:$('pin').value});$('pin').value='';if(result.mustChangePin)throw Error('Set your PIN in the PanelStock app before opening the register.');const issued=result.token;if(!issued)throw Error('Sign-in did not return a session. Please retry.');token=issued;if(!result.isAdmin){try{await api('/logout',{});}finally{clearSession();}throw Error('An administrator account is required.');}try{sessionStorage.setItem('panelstock-attendance-admin',token);}catch{}await load();openRegister();});});
$('logout').addEventListener('click',()=>action(async()=>{try{await api('/logout',{});}finally{clearSession();}}));
$('refresh').addEventListener('click',()=>action(()=>load()));$('load-more').addEventListener('click',()=>action(()=>load(true)));
for(const key of ['active','history'])$('tab-'+key).addEventListener('click',()=>{view=key;for(const tab of ['active','history'])$('tab-'+tab).setAttribute('aria-pressed',String(tab===key));render();});$('search').addEventListener('input',render);$('filter').addEventListener('change',render);
$('pair').addEventListener('click',()=>{if(!confirm('Create a station link? This replaces any existing station link and disables previously paired stations.'))return;action(async()=>{const result=await api('/attendance/kiosk',{}),url=location.origin+'/sign-in/#'+result.kioskToken;$('station-link').value=url;$('open-station').href=url;$('station-output').hidden=false;});});
$('revoke').addEventListener('click',()=>{if(!confirm('Revoke station access? People will need a new station link before they can sign in or out.'))return;action(async()=>{await api('/attendance/kiosk/revoke',{});$('station-link').value='';$('open-station').removeAttribute('href');$('station-output').hidden=true;status.textContent='Station access has been revoked. Create a new link when you are ready to set up a station.';});});
$('copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('station-link').value);$('copy').textContent='Copied';setTimeout(()=>$('copy').textContent='Copy link',2000);}catch{$('station-link').focus();$('station-link').select();status.textContent='Copy the selected station link.';}});
function csvCell(value){let text=String(value??'');if(/^\s*[=+@-]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';}
$('export').addEventListener('click',()=>action(async()=>{let values;if(view==='active'){values=activeEntries;}else{let result=await api('/attendance/register'),all=[...result.entries],seen=new Set();while(result.nextCursor){if(seen.has(result.nextCursor))throw Error('Unable to complete the export. Refresh and retry.');seen.add(result.nextCursor);result=await api('/attendance/register',{cursor:result.nextCursor,limit:100});all.push(...result.entries);}values=all;}values=filtered(values);const headings=['Name','Type','Company','Contact','Host','Purpose','Site safety acknowledged','Workshop / work area access','PPE confirmed','Emergency procedure understood','Site access understood','Hazard reporting understood','Undertaking work','Site induction completed','Work risks discussed','Staff follow-up','Signed in (Brisbane)','Signed out (Brisbane)'],lines=[headings,...values.map(entry=>[entry.name,entry.type,entry.company,entry.contact,entry.host,entry.purpose,safetyAnswer(entry,'visitorSafetyAcknowledged'),safetyAnswer(entry,'workshopAccess'),safetyAnswer(entry,'ppeConfirmed'),safetyAnswer(entry,'emergencyProcedureUnderstood'),safetyAnswer(entry,'siteAccessUnderstood'),safetyAnswer(entry,'hazardReportingUnderstood'),safetyAnswer(entry,'undertakingWork'),safetyAnswer(entry,'siteInductionCompleted'),safetyAnswer(entry,'workRisksDiscussed'),safetyFollowUp(entry),dateTime(entry.signedInAt),entry.signedOutAt?dateTime(entry.signedOutAt):''])],blob=new Blob(['\uFEFF'+lines.map(row=>row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='lennox-facades-attendance-'+(view==='active'?'on-site':'history')+'.csv';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}));
if(token)action(async()=>{const session=await api('/session');if(!session.isAdmin){clearSession();throw Error('An administrator account is required.');}await load();openRegister();});
`;

export function buildAttendancePage(nonce, manage = false, apiBase = '') {
  const api = JSON.stringify(apiBase).replaceAll('<', String.fromCharCode(92)+'u003c');
  const safeNonce = String(nonce).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex,nofollow"><title>${manage ? 'Sign-in register' : 'Site sign-in'} · Lennox Facades</title><meta name="description" content="Lennox Facades site attendance for visitors, contractors and employees."><style nonce="${safeNonce}">${STYLE}</style></head><body><header class="topbar"><div class="brand-wrap"><a class="brand" href="${manage ? '/sign-in/manage' : '/sign-in/'}" aria-label="Lennox Facades attendance"><img src="${brandLogo}" alt="Lennox Facades" width="200" height="80"></a><span class="header-label">Site attendance</span></div><div class="topmeta"><strong id="today"></strong><span>Australia / Brisbane</span></div></header>${manage ? MANAGE_BODY : KIOSK_BODY}<script nonce="${safeNonce}">const API_BASE=${api};function updateDate(){document.getElementById('today').textContent=new Date().toLocaleDateString('en-AU',{timeZone:'Australia/Brisbane',weekday:'long',day:'numeric',month:'long'});}updateDate();setInterval(updateDate,60000);${manage ? MANAGE_SCRIPT : KIOSK_SCRIPT}</script></body></html>`;
}
