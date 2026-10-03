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

// Keep 12-bootstrap.js the final explicit editor script for the invariant checks,
// but load the GGUF integration immediately before it. The integration defers
// its patches with setTimeout(0), so bootstrap can finish first.
document.write('<script src="js/13-local-llm.js"><\/script>');
