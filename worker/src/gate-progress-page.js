export const gateProgressStyles=`
:root{font-family:inherit;color:#172638;font-size:14px}
*{box-sizing:border-box}
main{padding:0}
h2{margin:0;font-size:18px;font-weight:650}
p{line-height:1.6}
.toolbar,.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.toolbar{justify-content:space-between;gap:16px;margin:0 0 12px}
.overview{display:flex;align-items:center;flex-wrap:wrap;gap:20px}
#mode{font-size:13px;color:#6b798a}
.muted{font-size:12px;color:#64748b}
.status-legend{display:flex;align-items:center;gap:14px;font-size:11px;color:#7b8998}
.status-legend>span{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.status-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#d8e0e8}
.status-dot.is-complete{background:#4d9b80}
.status-dot.is-rework{background:#c79c4a}
button,.button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:35px;border:1px solid #d3dee7;border-radius:8px;padding:8px 12px;background:#fff;color:#42586a;font-family:inherit;font-size:13px;font-weight:550;line-height:1.4;cursor:pointer;text-decoration:none}
button:hover,.button:hover{background:#f0f5f8}
button.primary{background:#155e75;border-color:#155e75;color:#fff}
button.primary:hover{background:#164e63}
button:disabled{opacity:.5;cursor:default}
button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,.scroll:focus-visible,summary:focus-visible{outline:2px solid #155e75;outline-offset:3px}
.card{margin:0 0 12px;border:1px solid #dce4ec;border-radius:12px;overflow:hidden;background:#fff;box-shadow:0 2px 5px #16374903}
.villa-summary{display:grid;grid-template-columns:180px minmax(0,1fr) 28px;align-items:center;gap:16px;padding:10px 16px}
[data-row-toggle]{cursor:pointer}
.villa-summary[data-row-toggle]:hover{background:#fafcfd}
.order-row[data-row-toggle]:hover>th,.order-row[data-row-toggle]:hover>td{background:#e4eef7}
.set-row[data-row-toggle]:hover>th,.set-row[data-row-toggle]:hover>td{background:#f0f5f8}
.villa-name{display:flex;align-items:center;gap:8px;min-width:0}
.villa-name h2{font-size:16px;font-weight:650;letter-spacing:-.02em;line-height:1.3;margin:0 0 3px;color:#243c4d;overflow-wrap:anywhere}
.villa-name p{font-size:12px;color:#778495;line-height:1.5;margin:0}
.house{display:grid;place-items:center;flex:none;width:28px;height:28px;border:1px solid #e2e9ef;border-radius:7px;background:#f4f8fa;color:#456271}
.house svg{width:18px;height:18px}
.summary-metrics{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:14px;min-width:0}
.metric{min-width:0}
.metric-label{font-size:11px;color:#728191;line-height:1.25;min-height:28px;overflow-wrap:normal}
.metric-value{display:flex;align-items:center;gap:4px;font-size:15px;font-weight:650;line-height:1.3;color:#3d5363;font-variant-numeric:tabular-nums}
.metric-value small{font-size:12px;font-weight:450;color:#96a3af}
.metric-value .metric-unit{font-size:10px;line-height:1.3;color:#96a3af;font-weight:450}
.metric.is-complete .metric-value{color:#347a65}
.metric.is-rework .metric-value,.metric.is-rework .metric-value small{color:#ad742b}
.progress-track{height:3px;border-radius:4px;background:#eaf0f4;margin-top:5px;overflow:hidden}
.progress-track span{display:block;height:100%;border-radius:4px;background:#5f9e91}
.metric.is-pending .progress-track span{background:#b4c1ca}
.metric.is-rework .progress-track span{background:#c49b56}
.villa-toggle{justify-self:end;color:#788795}
.villa-toggle.tree-toggle,.villa-toggle .tree-toggle{padding:6px;border-radius:6px}
.villa-toggle.tree-toggle:hover,.villa-toggle .tree-toggle:hover{background:#edf3f7}
.scroll{overflow:auto;border-top:1px solid #e5ebf0}
table{width:100%;min-width:1000px;border-collapse:collapse;table-layout:fixed;font-size:14px}
th,td{height:36px;padding:5px 10px;text-align:left;border-bottom:1px solid #edf1f5;vertical-align:middle}
thead th{height:36px;padding-top:4px;padding-bottom:4px;background:#fafbfd;font-size:12px;line-height:1.25;color:#7b8998;font-weight:600;white-space:normal;vertical-align:middle;text-align:center}
thead th:first-child{width:39%;padding-left:16px;text-align:left}
thead th:last-child{width:82px}
tbody th{font-weight:500}
.row-identity{display:flex;align-items:center;gap:10px;min-height:25px}
.row-identity strong{font-size:14px;font-weight:650;color:#25465a}
.row-identity small{display:block;font-size:12px;font-weight:400;color:#718799;margin-top:5px}
.order-row th,.order-row td{height:44px;background:#ebf2f9;border-top:1px solid #dce7f0;border-bottom:1px solid #dce7f0}
.order-identity{padding-left:4px;justify-content:space-between;gap:10px}
.order-identity>span{display:flex;align-items:center;gap:2px 10px;flex-wrap:wrap;flex:1;min-width:0}
.order-title{display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap}
.order-type{display:inline-flex;align-items:center;margin-left:8px;border:1px solid #cedee9;border-radius:5px;background:#f5f9fc;padding:3px 6px;color:#537081;font-size:11px;font-weight:550;line-height:1.3;vertical-align:middle}
.order-title .order-type{margin-left:0}
.order-identity .order-meta{color:#6b8092;font-size:12px;line-height:1.4;margin:0;min-width:0;max-width:100%;overflow-wrap:anywhere}
.order-meta b{font-weight:500;color:#a1b0bc;margin:0 7px}
.setup-note{display:block;color:#7e91a1;font-size:11px;line-height:1.5;margin-top:3px}
.set-row th,.set-row td{height:32px;padding-top:4px;padding-bottom:4px;background:#f8fafc;color:#718292;font-size:13px}
.set-identity{min-height:22px;margin-left:22px;padding-left:10px;border-left:2px solid #cbdbe5}
.set-identity>span{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.set-identity .tree-toggle{min-height:22px}
.set-identity strong{font-size:13px;font-weight:600;color:#5e7788}
.set-identity small{font-size:11px;color:#93a1ad;margin:0}
.component-row{background:#fff}
.component-identity{margin-left:42px;padding-left:10px;border-left:1px solid #dfe7ee}
.component-identity strong{font-size:14px;font-weight:500;color:#425a6c}
.component-identity>span{display:flex;align-items:center;gap:10px;flex:1;min-width:0}
.stage-heading{padding-left:7px;padding-right:7px;text-align:center}
.stage-heading>span{font-size:12px;font-weight:600;white-space:normal}
.stage-cell{padding:4px 8px;text-align:center;color:#8a98a6;font-size:13px;font-weight:500}
.stage-marker{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;border-radius:50%;background:#f0f4f7;color:#aebbc5;font-size:13px;font-weight:650}
.stage-cell.is-complete .stage-marker,.stage-marker.is-complete{background:#e9f4ee;color:#40836e}
.stage-cell.is-rework .stage-marker,.stage-marker.is-rework{background:#fff1e4;color:#ad742b}
.tree-toggle{display:inline-flex;align-items:center;justify-content:flex-start;gap:7px;min-height:24px;padding:0;border:0;background:transparent;font:inherit;color:inherit;text-align:left}
.tree-toggle:hover{background:transparent;color:#155e75}
.tree-toggle svg{flex:none;transition:transform .15s}
.tree-toggle[aria-expanded=true] svg{transform:rotate(90deg)}
.edit-order{flex:none;min-height:29px;padding:5px 9px;font-size:12px;color:#155e75;background:#f7fbfe}
.component-details,.details-button{border:0;background:transparent;padding:4px 0;min-height:28px;color:#6d8a9b;font-size:12px;font-weight:550;white-space:nowrap}
.component-row .component-details{min-height:24px;padding:2px 0}
.component-details:hover,.details-button:hover{background:transparent;color:#155e75;text-decoration:underline}
.detail-cell,.details-cell{text-align:center}
.detail-heading{position:relative;width:82px}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.mobile-details{display:none}
.card-footer{padding:5px 16px;color:#92a0ad;font-size:11px;line-height:1.4;border-top:1px solid #edf1f5;background:#fdfefe}
.previous-qa{margin:14px 0;padding:12px;background:#f8fafc;border:1px solid #cbd5e1;border-radius:8px;font-size:13px}
.previous-qa summary{cursor:pointer;font-weight:600}
.previous-qa article{padding:12px 0;border-top:1px solid #e2e8f0}
.previous-qa-photo{max-width:140px;max-height:100px;margin:4px}
.legacy-qa-review{display:flex;gap:8px;align-items:flex-start;padding:12px;background:#fffbeb;border-radius:8px}
.legacy-qa-review input{flex:none;margin-top:2px}
.component-editor-set{margin:14px 0;padding:12px 14px;border:1px solid #d8e1ea;border-radius:9px;background:#f8fafc}
.component-editor-set legend{padding:0 6px;font-size:13px;font-weight:600;color:#334155}
.three{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.component-editor-set label{margin:0}
.component-editor-set input{min-width:0}
#dialogNotice{padding:10px 12px;border-radius:7px;background:#fff7df;color:#854d0e}
.banner{padding:10px 14px;margin:12px 0;border:1px solid #bae6fd;border-radius:8px;background:#f0f9ff;color:#155e75;font-size:13px}
.empty{padding:40px 20px;border:1px dashed #cbd5e1;border-radius:12px;background:#fff;text-align:center;color:#64748b;font-size:14px}
.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}
label{display:block;font-size:13px;font-weight:500;color:#475569;margin:14px 0}
input:not([type=checkbox]),select,textarea{display:block;width:100%;border:1px solid #cbd5e1;border-radius:8px;padding:10px 12px;font:inherit;background:#fff;margin-top:6px}
textarea{min-height:75px}
dialog{margin:auto;border:1px solid #d9e3ea;border-radius:14px;padding:25px;width:min(95vw,650px);max-height:90vh;overflow:auto;color:#203b4b;box-shadow:0 20px 80px #17394c26}
dialog h2{font-size:21px;letter-spacing:-.025em}
dialog p{font-size:13px;color:#708493}
dialog::backdrop{background:#132c3d65}
.detail-head,.dialog-head{display:flex;justify-content:space-between;align-items:flex-start;gap:18px}
.detail-head h2,.dialog-head h2{margin:0 0 7px;font-size:23px}
.detail-subtitle,.dialog-subtitle{margin:0;color:#7f8d99;font-size:12px}
.icon-button{display:inline-flex;align-items:center;justify-content:center;flex:none;min-width:32px;min-height:32px;border:0;border-radius:7px;background:transparent;padding:5px;color:#788795;font-size:20px}
.icon-button:hover{background:#edf3f7}
.detail-stages{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;border:1px solid #e1e8ef;border-radius:9px;overflow:hidden;margin:22px 0;background:#e8eef3}
.detail-stage{display:flex;flex-direction:column;justify-content:space-between;gap:8px;padding:12px;background:#fff;font-size:13px}
.detail-stage>span{font-size:11px;line-height:1.4;color:#7d8e9c}
.detail-stage strong{font-size:13px;line-height:1.4;font-weight:600}
.detail-stage.is-complete strong{color:#347a65}
.detail-stage.is-pending strong{color:#8190a1}
.detail-stage.is-rework strong{color:#ad742b}
.detail-complete,.detail-state.is-complete{color:#347a65}
.detail-pending,.detail-state.is-pending{color:#8190a1}
.detail-rework,.detail-state.is-rework{color:#ad742b}
.detail-facts,.detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px 25px;margin:24px 0}
.detail-facts dt,.detail-grid dt{font-size:12px;color:#8695a3;margin-bottom:6px}
.detail-facts dd,.detail-grid dd{margin:0;font-size:14px;color:#395465;line-height:1.5;overflow-wrap:anywhere}
.detail-note{padding:12px;border-radius:8px;background:#fff1e4;color:#9d6a28;font-size:13px;line-height:1.6}
.detail-foot{font-size:12px;color:#91a0ac;margin-bottom:0}
.inspection-history{margin:20px 0 0;padding:13px;background:#f8fafc;border:1px solid #dce5ed;border-radius:9px;font-size:13px}
.inspection-history summary{cursor:pointer;font-weight:600;color:#526c7d}
.inspection-history article{margin-top:12px;padding-top:12px;border-top:1px solid #e2e9ef}
.inspection-history article p{font-size:12px;line-height:1.6;margin:6px 0}
.two{display:grid;grid-template-columns:1fr 1fr;gap:15px}
#notice{position:sticky;top:8px;z-index:5;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px;font-size:13px;white-space:pre-wrap}
#notice:empty{display:none}
.photos{display:flex;gap:8px;flex-wrap:wrap}
.photos img{max-width:110px;max-height:90px}
[hidden]{display:none!important}
@media(max-width:1100px){.villa-summary{grid-template-columns:160px minmax(0,1fr) 28px;gap:12px;padding:10px 14px}.summary-metrics{gap:12px}.metric-value{font-size:15px}}
@media(max-width:740px){.toolbar{align-items:flex-start;gap:12px}.overview{width:100%;gap:10px 18px}.toolbar .row{gap:8px}button,.button{min-height:36px}.villa-summary{grid-template-columns:minmax(0,1fr) 28px;gap:12px;padding:12px}.villa-name h2{font-size:16px}.summary-metrics{grid-row:2;grid-column:1/-1;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px 16px}.metric-label{min-height:28px;font-size:11px}.metric-value{font-size:15px}.villa-toggle{grid-column:2;grid-row:1}.two,.detail-facts,.detail-grid{grid-template-columns:1fr}.detail-stages{grid-template-columns:repeat(2,minmax(0,1fr))}thead th:first-child{width:calc(100vw - 72px)}.order-identity{padding-left:4px}.order-identity>span{display:block}.order-identity .order-meta{margin-top:2px}.set-identity{margin-left:22px}.component-identity{margin-left:36px;justify-content:space-between;gap:8px}.component-row .component-details{min-height:28px}.mobile-details{display:inline-flex;flex:none;margin-left:auto;min-height:28px;font-size:11px}.status-legend{gap:11px}}
@media(prefers-reduced-motion:reduce){.tree-toggle svg{transition:none}}
`;
export const gateProgressMarkup='<div id="notice" role="status" aria-live="polite"></div><div class="toolbar"><div class="overview"><div id="mode" class="muted"></div><div class="status-legend" aria-label="Progress legend"><span><i class="status-dot is-complete" aria-hidden="true"></i>Complete</span><span><i class="status-dot is-rework" aria-hidden="true"></i>Needs attention</span><span><i class="status-dot is-pending" aria-hidden="true"></i>Pending</span></div></div><div class="row"><button id="expandAll" type="button" data-action="expand-all">Expand all</button><button type="button" data-action="refresh">Refresh</button></div></div><div id="content"><p>Loading gate progress…</p></div><dialog id="editor"><div id="dialogBody"></div></dialog>';
