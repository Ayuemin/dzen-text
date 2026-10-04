(function(){
'use strict';

function nativeDiagnosticsAvailable(){
  return !!(window.AndroidDiagnostics&&typeof AndroidDiagnostics.read==='function'&&typeof AndroidDiagnostics.log==='function');
}
function diag(message){
  try{if(nativeDiagnosticsAvailable())AndroidDiagnostics.log('JS-SPELL',String(message||''))}catch(e){}
}
function spellingStateText(){
  try{
    const d=currentAnalysis&&currentAnalysis.spellingDiagnostics;
    if(!d)return 'none';
    return String(d.state||'unknown')+' checked='+Number(d.checked||0)+' issues='+Number(d.issues||0)+' error='+String(d.error||'');
  }catch(e){return 'state-error:'+String(e&&e.message||e)}
}
function nativeSpellStatus(){
  try{return window.AndroidSpelling&&typeof AndroidSpelling.status==='function'?String(AndroidSpelling.status()||'{}'):'bridge-missing'}catch(e){return 'status-error:'+String(e&&e.message||e)}
}
function diagnosticsRoot(){
  return document.querySelector('#settingsBackdrop .settingsGroupWrap');
}
function diagnosticStatusElement(){
  return document.querySelector('#diagnosticLogStatus');
}
function refreshDiagnosticStatus(){
  const el=diagnosticStatusElement();if(!el)return;
  if(!nativeDiagnosticsAvailable()){
    el.textContent='Диагностический мост недоступен в этой сборке.';
    return;
  }
  let chars=0;
  try{chars=String(AndroidDiagnostics.read()||'').length}catch(e){}
  el.textContent='Журнал: '+chars+' символов. После воспроизведения ошибки скопируйте его и пришлите в чат.';
}
function copyDiagnosticLog(){
  if(!nativeDiagnosticsAvailable()){toast('Диагностический журнал недоступен');return false}
  let text='';try{text=String(AndroidDiagnostics.read()||'')}catch(e){}
  if(!text){toast('Диагностический журнал пуст');return false}
  let ok=false;
  try{
    ok=!!(window.AndroidPublish&&typeof AndroidPublish.copyForPublication==='function'&&AndroidPublish.copyForPublication('',text));
  }catch(e){}
  if(ok)toast('Диагностический журнал скопирован');else toast('Не удалось скопировать диагностический журнал');
  refreshDiagnosticStatus();
  return ok;
}
function clearDiagnosticLog(){
  if(!nativeDiagnosticsAvailable()){toast('Диагностический журнал недоступен');return false}
  try{AndroidDiagnostics.clear();diag('diagnostic log cleared from settings');refreshDiagnosticStatus();toast('Диагностический журнал очищен');return true}
  catch(e){toast('Не удалось очистить диагностический журнал');return false}
}
function installDiagnosticSettings(){
  const root=diagnosticsRoot();if(!root||document.querySelector('#diagnosticSettingsGroup'))return;
  const group=document.createElement('details');
  group.className='settingsGroup';group.id='diagnosticSettingsGroup';
  group.innerHTML='<summary><span>Диагностика</span><small>Журнал для поиска зависаний проверки</small></summary><div class="settingsGroupBody"><div id="diagnosticLogStatus" class="smallNote">Диагностический журнал готов.</div><div class="settingActions"><button class="nativeBtn primarySettingBtn" type="button" onclick="copyDiagnosticLog()">Скопировать диагностический лог</button><button class="nativeBtn" type="button" onclick="clearDiagnosticLog()">Очистить лог</button></div><div class="smallNote">Для чистого теста сначала очистите журнал, затем запустите «Проверить», дождитесь ошибки и сразу скопируйте лог.</div></div>';
  root.appendChild(group);refreshDiagnosticStatus();
}

window.copyDiagnosticLog=copyDiagnosticLog;
window.clearDiagnosticLog=clearDiagnosticLog;
window.refreshDiagnosticStatus=refreshDiagnosticStatus;

installDiagnosticSettings();
diag('diagnostics module loaded; nativeStatus='+nativeSpellStatus());

let lastHeartbeat=0;
if(typeof setInterval==='function')setInterval(function(){
  const d=typeof currentAnalysis==='object'&&currentAnalysis&&currentAnalysis.spellingDiagnostics;
  if(!d||d.state!=='checking')return;
  const now=Date.now();if(now-lastHeartbeat<1900)return;lastHeartbeat=now;
  diag('checking heartbeat; js='+spellingStateText()+'; native='+nativeSpellStatus());
},500);
})();
