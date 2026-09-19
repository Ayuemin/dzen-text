let appConfirmResolve=null;

function appConfirm(title,text,confirmLabel='Продолжить',danger=false){
  return new Promise(resolve=>{
    if(appConfirmResolve)appConfirmResolve(false);
    appConfirmResolve=resolve;
    const backdrop=document.getElementById('confirmBackdrop');
    document.getElementById('confirmTitle').textContent=title||'Подтвердите действие';
    document.getElementById('confirmText').textContent=text||'';
    const ok=document.getElementById('confirmOk');
    ok.textContent=confirmLabel||'Продолжить';
    ok.classList.toggle('danger',!!danger);
    backdrop.classList.add('open');
    setTimeout(()=>ok.focus(),30);
  });
}

function resolveAppConfirm(value){
  const backdrop=document.getElementById('confirmBackdrop');
  if(backdrop)backdrop.classList.remove('open');
  const resolve=appConfirmResolve;
  appConfirmResolve=null;
  if(resolve)resolve(!!value);
}

function confirmBackdropClick(event){
  if(event.target&&event.target.id==='confirmBackdrop')resolveAppConfirm(false);
}
